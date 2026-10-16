/**
 * 逆地理编码：把坐标换成一句人看得懂的地名（高德方案）。
 *
 * 用高德两个官方能力：
 * - `AMap.Geocoder.getAddress()`：逆地理编码，拿到 formatted_address 与 addressComponent
 * - `AMap.PlaceSearch.searchNearBy()`：附近 POI 搜索，用来找出「××水库」「××公园」这种
 *   有辨识度的地名。Geocoder 已经带回附近 POI 时不会再发这次请求。
 *
 * 三条纪律：
 * 1. **只在用户主动动作时查询**（点「获取当前位置」、在地图上选点），
 *    轨迹记录过程中一个点都不会来查 —— 这里没有任何轮询。
 * 2. **查询失败不影响定位**：失败就返回 error 状态，由界面提示「自己填名字」。
 * 3. **绝不拿坐标编名字**：没有任何可用地名时返回 empty，界面上说的是「这一带没有地名」。
 *
 * 高德的服务类请求需要安全密钥，本项目通过代理解决（见 config.ts）。
 * 没有代理时这里会明确报「未配置代理」，而不是假装查到了。
 */
import { fromMapLngLat, toMapLngLat } from '../coord'
import { canUseAmapServices, describeAmapGap } from './config'
import { loadAmap } from './loader'
import type { Coordinate } from '../coord'

/** 署名：用了高德的地名与 POI 数据 */
export const PLACE_ATTRIBUTION = '地名与 POI 数据 © 高德地图'
export const PLACE_ATTRIBUTION_URL = 'https://www.amap.com/'

/** 附近 POI 的搜索半径（米）。再远就不算「这一带」了 */
const POI_RADIUS_M = 1_500
/** 结果缓存的粒度：经纬度保留 4 位小数，约 11 米以内算同一个地方 */
const CACHE_DIGITS = 4
const CACHE_TTL_MS = 30 * 60_000
const CACHE_LIMIT = 60

/** 补搜附近 POI 时用的关键词。高德的多关键词用 | 分隔 */
const NEARBY_QUERY = '水库|湖|河|公园|湿地|桥'

/** 名字里带这些字的 POI，最像是「一片可路亚的水域」 */
const WATER_HINTS = ['水库', '湖', '河', '江', '溪', '塘', '潭', '湾', '港', '闸', '坝', '湿地', '岛', '滩', '垂钓']
/** 其次是公园、景区这类有辨识度的地点 */
const SCENIC_HINTS = ['公园', '风景', '景区', '广场']

export interface PlaceName {
  /** 用来当地点名的名字：水库、湖泊、河流、公园、道路、村镇… */
  name: string
  /** 更上一层的范围，例如「杭州市 西湖区」；没有就为空串 */
  area: string
  /** 高德返回的完整地址，给用户看更多细节 */
  full: string
}

export type GeocodeResult =
  | { status: 'ok'; place: PlaceName }
  /** 服务正常返回，但这一带确实没有可用的名字 */
  | { status: 'empty' }
  | { status: 'error'; message: string }

/** 带用户可读文案的错误，用来和脚本加载错误区分开 */
class PlaceError extends Error {}

/* ------------------------------ 小工具 ------------------------------ */

function text(value: unknown): string {
  // 高德在字段缺失时经常返回空数组 []，只认字符串
  return typeof value === 'string' ? value.trim() : ''
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value)
    if (result) return result
  }
  return ''
}

function toDistance(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // 高德 POI 的 distance 是字符串
  const parsed = Number.parseFloat(text(value))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

interface LngLat {
  lng: number
  lat: number
}

/** 兼容三种形态：AMap.LngLat 对象、{lng,lat}、REST 风格的 [lng,lat] */
function readLngLat(value: unknown): LngLat | null {
  if (!value) return null

  if (typeof value === 'object' && value !== null) {
    const raw = value as Record<string, unknown>
    const lng = typeof raw.lng === 'number' ? raw.lng : Number.NaN
    const lat = typeof raw.lat === 'number' ? raw.lat : Number.NaN
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat }

    if (typeof raw.getLng === 'function' && typeof raw.getLat === 'function') {
      const anyValue = value as { getLng: () => number; getLat: () => number }
      const glng = anyValue.getLng()
      const glat = anyValue.getLat()
      if (Number.isFinite(glng) && Number.isFinite(glat)) return { lng: glng, lat: glat }
    }
  }

  if (Array.isArray(value) && value.length >= 2) {
    const lng = typeof value[0] === 'number' ? value[0] : Number.NaN
    const lat = typeof value[1] === 'number' ? value[1] : Number.NaN
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat }
  }

  return null
}

/* --------------------------- 地址解析（纯函数） --------------------------- */

interface PoiCandidate {
  name: string
  type: string
  address: string
  distance: number
  location: LngLat | null
}

function readPoi(value: unknown): PoiCandidate | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const name = text(raw.name)
  if (!name) return null

  return {
    name,
    type: text(raw.type),
    address: text(raw.address),
    distance: toDistance(raw.distance),
    location: readLngLat(raw.location),
  }
}

/**
 * POI 的「像个钓点」程度：越小越优先。
 * 0 = 水域/桥闸；1 = 公园景区；2 = 其它地点（一般不用来当名字）
 */
function rankPoi(poi: PoiCandidate): number {
  const name = poi.name
  const type = poi.type

  if (WATER_HINTS.some((hint) => name.includes(hint))) return 0
  if (WATER_HINTS.some((hint) => type.includes(hint))) return 0
  if (SCENIC_HINTS.some((hint) => name.includes(hint))) return 1
  if (SCENIC_HINTS.some((hint) => type.includes(hint))) return 1
  return 2
}

/** 名字太短的（「湖」「桥」）当不了地名，排除 */
function isUsableName(name: string): boolean {
  return name.length >= 2 && name.length <= 30
}

function collectCandidates(regeocode: unknown, extraPois: unknown): PoiCandidate[] {
  const raw =
    typeof regeocode === 'object' && regeocode !== null
      ? (regeocode as Record<string, unknown>)
      : {}

  const candidates: PoiCandidate[] = []
  for (const item of Array.isArray(raw.pois) ? raw.pois : []) {
    const poi = readPoi(item)
    if (poi) candidates.push(poi)
  }
  for (const item of Array.isArray(extraPois) ? extraPois : []) {
    const poi = readPoi(item)
    if (poi) candidates.push(poi)
  }
  return candidates
}

/**
 * 挑出「像个钓点」的那个 POI：距离够近、名字够具体、类别是水域或公园。
 * 挑不出来返回 null —— 调用方会退到道路 / 区县 / 城市。
 */
function pickLandmarkPoi(candidates: PoiCandidate[]): PoiCandidate | null {
  const best = candidates
    .filter((poi) => {
      if (!isUsableName(poi.name)) return false
      // 拿不到距离的（Geocoder 有时不给）不参与排序，但仍然可以用
      return Number.isNaN(poi.distance) || poi.distance <= POI_RADIUS_M
    })
    .map((poi) => ({
      poi,
      rank: rankPoi(poi),
      distance: Number.isNaN(poi.distance) ? POI_RADIUS_M : poi.distance,
    }))
    .filter((item) => item.rank < 2)
    .sort((a, b) => a.rank - b.rank || a.distance - b.distance)[0]

  return best ? best.poi : null
}

/**
 * 从高德的返回里挑出最适合当地名的那个名字（纯函数，可离线测试）。
 *
 * 顺序：附近有辨识度的 POI（水库/湖/河/公园/桥…）→ 道路 → 街道乡镇 → 区县 → 城市。
 * 全都没有时返回 null，由调用方显示「没查到地名」，**不会拿坐标编一个**。
 */
export function describeAmapPlace(
  regeocode: unknown,
  extraPois: unknown = [],
): PlaceName | null {
  const raw =
    typeof regeocode === 'object' && regeocode !== null
      ? (regeocode as Record<string, unknown>)
      : {}
  const component =
    typeof raw.addressComponent === 'object' && raw.addressComponent !== null
      ? (raw.addressComponent as Record<string, unknown>)
      : {}

  const full = text(raw.formatted_address)

  const candidates = collectCandidates(regeocode, extraPois)
  const best = pickLandmarkPoi(candidates)

  const street = text(component.street)
  const streetNumber =
    typeof component.streetNumber === 'object' && component.streetNumber !== null
      ? (component.streetNumber as Record<string, unknown>)
      : {}
  const streetName = street || text(streetNumber.street)

  const township = firstText(component.township, component.town)
  const district = firstText(component.district)
  const city = firstText(component.city, component.province)
  const formattedFirst = full ? (full.split(/[,，]/)[0]?.trim() ?? '') : ''

  const name =
    (best ? best.name : '') ||
    streetName ||
    township ||
    district ||
    city ||
    formattedFirst

  if (!name) return null

  return {
    name,
    area: describeArea(name, { city, district, township }),
    full: full || name,
  }
}

/** 上一层范围，用来补充说明；「中国」这类噪声不列 */
function describeArea(
  usedName: string,
  parts: { city: string; district: string; township: string },
): string {
  const list: string[] = []
  for (const value of [parts.city, parts.district, parts.township]) {
    if (value && value !== usedName && !list.includes(value)) list.push(value)
  }
  return list.slice(0, 2).join(' ')
}

/* --------------------------- 服务调用与错误翻译 --------------------------- */

function readServiceError(info: string): string {
  if (info.includes('INVALID_USER_SCODE') || info.includes('INVALID_USER_KEY')) {
    return '高德的 Key 或安全密钥没配对：请检查 .env.local 里的 VITE_AMAP_KEY，以及代理服务里的安全密钥。'
  }
  if (info.includes('USERKEY_PLAT_NOMATCH')) {
    return '这个高德 Key 的类型不对：需要「Web 端（JS API）」类型的 Key。'
  }
  if (info.includes('DAILY_QUERY_OVER_LIMIT') || info.includes('CUQPS')) {
    return '高德服务的调用次数到上限了，过一会儿再试，或者直接自己填地名。'
  }
  if (info.includes('SERVICE_NOT_AVAILABLE')) {
    return '高德这个接口暂时不可用，可以自己填地名。'
  }
  return '地名查询失败了（可以自己填地段名字，不影响定位和出勤）。'
}

/** 需要用户动手配置时说清楚缺什么，别让人以为是网络问题 */
function requireServices(): void {
  if (canUseAmapServices()) return
  throw new PlaceError(describeAmapGap() ?? '高德服务不可用。')
}

async function getGeocoder(lngLat: LngLat): Promise<PlaceName | null> {
  const AMapNamespace = await loadAmap()
  requireServices()

  const geocoder = new AMapNamespace.Geocoder({
    // 逆地理编码取附近的 POI，一次请求就够用
    radius: POI_RADIUS_M,
    extensions: 'all',
  })

  const regeocode = await new Promise<unknown>((resolve, reject) => {
    geocoder.getAddress([lngLat.lng, lngLat.lat], (status, data) => {
      if (status === 'complete' && data?.info === 'OK' && data.regeocode) {
        resolve(data.regeocode)
        return
      }
      if (status === 'no_data') {
        resolve(null)
        return
      }
      reject(new PlaceError(readServiceError(text(data?.info) || status)))
    })
  })

  if (!regeocode) return null

  // Geocoder 已经带回附近的水域/公园 POI 就够用了，不再多发一次请求
  if (pickLandmarkPoi(collectCandidates(regeocode, []))) {
    return describeAmapPlace(regeocode)
  }

  const extra = await searchNearbyPois(lngLat).catch(() => [])
  return describeAmapPlace(regeocode, extra)
}

/** Geocoder 没带回合适的 POI 时，按关键词补搜一次附近 */
async function searchNearbyPois(lngLat: LngLat): Promise<unknown[]> {
  const AMapNamespace = await loadAmap()
  const search = new AMapNamespace.PlaceSearch({ pageSize: 25, extensions: 'base' })

  return new Promise<unknown[]>((resolve, reject) => {
    search.searchNearBy(
      NEARBY_QUERY,
      [lngLat.lng, lngLat.lat],
      POI_RADIUS_M,
      (status, data) => {
        if (status === 'complete' && data?.info === 'OK') {
          resolve(data.poiList?.pois ?? [])
          return
        }
        if (status === 'no_data') {
          resolve([])
          return
        }
        reject(new PlaceError(readServiceError(text(data?.info) || status)))
      },
    )
  })
}

/* ------------------------------ 缓存 ------------------------------ */

interface CacheEntry {
  at: number
  result: GeocodeResult
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<GeocodeResult>>()

export function cacheKeyOf(point: Coordinate): string {
  return `${point.latitude.toFixed(CACHE_DIGITS)},${point.longitude.toFixed(CACHE_DIGITS)}`
}

function remember(key: string, result: GeocodeResult): void {
  cache.set(key, { at: Date.now(), result })
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/* ------------------------------ 对外接口 ------------------------------ */

/**
 * 查一个坐标的地名。命中缓存立刻返回；同一坐标并发只发一次请求。
 *
 * 传入的是**存储坐标（WGS84）**，内部转成高德要的 GCJ-02 再请求。
 */
export function reverseGeocode(point: Coordinate): Promise<GeocodeResult> {
  const key = cacheKeyOf(point)

  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.result)
  }

  const pendingRequest = inflight.get(key)
  if (pendingRequest) return pendingRequest

  const [lng, lat] = toMapLngLat(point)

  const task = getGeocoder({ lng, lat })
    .then((place): GeocodeResult => (place ? { status: 'ok', place } : { status: 'empty' }))
    .catch((error: unknown): GeocodeResult => ({
      status: 'error',
      message:
        error instanceof PlaceError
          ? error.message
          : '地名服务暂时连不上，不影响定位和出勤，标点名称自己填就行。',
    }))
    .then((result) => {
      inflight.delete(key)
      // 失败不进缓存，下次点「再查一次」还能真的重试
      if (result.status !== 'error') remember(key, result)
      return result
    })

  inflight.set(key, task)
  return task
}

/** 地图选点里的「搜索地点」用的一类结果 */
export interface PlaceHit {
  id: string
  name: string
  address: string
  /** 已经转成 WGS84，可以直接存进标点 */
  latitude: number
  longitude: number
}

interface SearchOptions {
  keyword: string
  /** 限定城市（可选）：高德的城市名或 adcode */
  city?: string
  /** 有中心点时按附近搜索，否则全国搜索 */
  center?: Coordinate | null
  radius?: number
}

/**
 * 搜索地点。地图选点弹窗用它：输入「千岛湖」能直接跳到那个位置。
 * 返回的坐标已经转成 WGS84，和标点里存的是同一套坐标系。
 */
export async function searchPlaces(options: SearchOptions): Promise<PlaceHit[]> {
  const keyword = options.keyword.trim()
  if (!keyword) return []

  requireServices()
  const AMapNamespace = await loadAmap()

  const search = new AMapNamespace.PlaceSearch({
    city: options.city || '全国',
    citylimit: false,
    pageSize: 15,
    extensions: 'base',
  })

  const pois = await new Promise<unknown[]>((resolve, reject) => {
    const handle: AMap.ServiceCallback<AMap.PlaceSearchResult> = (status, data) => {
      if (status === 'complete' && data?.info === 'OK') {
        resolve(data.poiList?.pois ?? [])
        return
      }
      if (status === 'no_data') {
        resolve([])
        return
      }
      reject(new PlaceError(readServiceError(text(data?.info) || status)))
    }

    if (options.center) {
      const [lng, lat] = toMapLngLat(options.center)
      search.searchNearBy(keyword, [lng, lat], options.radius ?? 20_000, handle)
      return
    }
    search.search(keyword, handle)
  })

  const hits: PlaceHit[] = []
  for (const item of pois) {
    const poi = readPoi(item)
    if (!poi || !poi.location) continue

    const stored = fromMapLngLat(poi.location.lng, poi.location.lat)
    hits.push({
      id: text((item as Record<string, unknown>).id) || `${poi.name}-${hits.length}`,
      name: poi.name,
      address: poi.address,
      latitude: stored.latitude,
      longitude: stored.longitude,
    })
  }
  return hits
}

/** 把未知错误翻译成给用户看的一句话 */
export function toGeocodeMessage(error: unknown): string {
  if (error instanceof PlaceError) return error.message
  return '地名查询失败了，可以自己填地名，不影响定位和出勤。'
}
