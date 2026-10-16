/**
 * 统一的定位服务：整个应用只有**一个** `AMap.Geolocation` 实例、**一个**采点循环。
 *
 * ## 为什么要有这一层
 *
 * 定位散在各个页面自己管，就会出三种毛病：同一个页面里的 GPS 卡片和地图显示的是两次
 * 不同的定位结果；暂停再开始会留下第二个监听器；刷新之后谁在监听说不清。
 * 所以这里把「定位」收敛成一个模块级的服务：
 *
 * - 实例只建一次（`AMap.Geolocation` 的 `getCurrentPosition` 本身就是「点一次拿一次」）
 * - 持续定位只有一条循环，谁先调 `startWatching` 谁开，调 `stopWatching` 就停
 * - 所有读数都经过同一套坐标系处理，出去的都是 **WGS84 + 来源标记**
 *
 * ## 关于坐标系（重点，别改错）
 *
 * 项目存的是 WGS84，高德地图画的是 GCJ-02。插件交出来的 `position` 是**哪一种，
 * 取决于插件自己走没走转换**，这里按插件源码逐个分支判断（见 `resolveConverted`）：
 *
 * - IP 定位、支付宝/UC 里的浏览器定位：插件标记 `isConverted = true`，出来就是 GCJ-02
 * - 其它设备定位：插件会调 `/v3/assistant/coordinate/convert` 把它转成 GCJ-02，
 *   转成功 / 失败只能从 `message` 里看出来
 *
 * 判断出来之后统一转成 WGS84 再交给上层，上层只管 WGS84，上地图时再由
 * `toMapLngLat` 转回 GCJ-02 —— 全程只转一次，绝不重复转换。
 *
 * ## 关于 IP 定位
 *
 * 高德在拿不到设备定位时会退回 IP 定位。它的误差可能有几公里，所以：
 * 照实标成 `source: 'ip'`，界面上写「IP 大致位置」，**绝不允许**写进标点、
 * 渔获或轨迹（`lib/geo.ts` 里统一挡掉）。
 *
 * ## 关于持续定位为什么不用插件的 watchPosition
 *
 * 插件源码里的 `watchPosition` 就是 `setInterval(() => getCurrentPosition(), 10000)`，
 * 而它的 `clearWatch` 只 `clearInterval` 却不重置内部计时器 id，
 * 导致**同一个实例 clearWatch 之后再也开不起来**（暂停 → 继续会静默失效）。
 * 所以这里自己按同样的 10 秒节奏轮询 `getCurrentPosition`：
 * 每一跳用的仍然是高德定位插件的能力，但暂停 / 继续 / 重开都是确定可用的。
 * 出勤中「暂停记录 → 继续记录」正是靠这一点才成立。
 */
import { fromMapLngLat } from '../coord'
import { hasCoordinates } from '../geo'
import { loadAmap } from './loader'
import type { LiveGeoPoint, LocationSource } from '../../types/trip'

/* ------------------------------- 参数 ------------------------------- */

/** 一次定位最多等多久（交给插件，最终落到浏览器的定位接口上） */
const GEO_TIMEOUT_MS = 15_000

/**
 * 接受多久以内的缓存读数。手机上刚定位过就直接用这条，比逼 GPS 冷启动快得多，
 * 也是之前「反复定位超时」的主要解法之一。
 */
const GEO_MAX_AGE_MS = 15_000

/** 持续定位的采点间隔，和插件 watchPosition 内部的 10 秒保持一致 */
const POLL_INTERVAL_MS = 10_000

/**
 * 服务自己兜底的超时：插件该超时却一直没回调时，靠这个保证
 * 界面上不会永远停在「定位中」。比上面那次超时留出 IP 兜底的时间。
 */
const OVERALL_TIMEOUT_MS = GEO_TIMEOUT_MS + 10_000

/**
 * 插件参数。这些值都是有意选的：
 * - `enableHighAccuracy`：默认 false，必须显式打开，否则拿到的多是粗定位
 * - `maximumAge`：默认 0，等于把系统手里刚拿到的读数丢掉，逼一次冷启动
 * - `GeoLocationFirst`：默认只在移动端为 true；桌面端会先试 IP！
 *   这里强制 true —— 设备定位优先，拿不到才退 IP
 * - `noIpLocate: 0`：允许 IP 兜底，但结果会被标成「IP 大致位置」且不允许入库
 * - `noGeoLocation: 0`：允许设备定位
 * - `showButton/showMarker/showCircle/panToLocation/zoomToAccuracy`：全部关掉，
 *   界面上的定位显示由项目自己画，卡片和地图才会显示同一个结果
 * - `needAddress: false`：地名单独用 Geocoder 查，避免每次定位都发一次请求
 */
const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: GEO_TIMEOUT_MS,
  maximumAge: GEO_MAX_AGE_MS,
  GeoLocationFirst: true,
  noIpLocate: 0,
  noGeoLocation: 0,
  useNative: false,
  convert: true,
  needAddress: false,
  extensions: 'base' as const,
  getCityWhenFail: false,
  showButton: false,
  showMarker: false,
  showCircle: false,
  panToLocation: false,
  zoomToAccuracy: false,
}

/* ------------------------------- 错误 ------------------------------- */

export type AmapGeoErrorCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NOT_SUPPORT'
  | 'PLUGIN_MISSING'
  | 'NO_KEY'
  | 'FAILED'

export class AmapLocationError extends Error {
  code: AmapGeoErrorCode
  /** 重试也没用的错误（没配 Key、插件没加载出来、权限被拒）：循环会停下来 */
  fatal: boolean

  constructor(code: AmapGeoErrorCode, message: string, fatal: boolean) {
    super(message)
    this.name = 'AmapLocationError'
    this.code = code
    this.fatal = fatal
  }
}

/** 把定位失败翻译成「发生了什么 + 下一步做什么」 */
export function describeLocationFailure(error: AmapLocationError): string {
  switch (error.code) {
    case 'PERMISSION_DENIED':
      return '定位权限被拒绝了。可以在浏览器地址栏的权限设置里重新允许定位；不开定位也能正常出勤，只是上鱼时不写位置。'
    case 'TIMEOUT':
      return '这次定位超时了（室内、地下车库或信号弱的地方容易这样）。走到开阔处再点「重新尝试定位」；出勤和上鱼都不受影响。'
    case 'POSITION_UNAVAILABLE':
      return '高德暂时拿不到位置（可能在室内，或者系统定位服务没开）。走到开阔处再点「重新尝试定位」；出勤和上鱼都不受影响。'
    case 'NOT_SUPPORT':
      return '当前环境不支持高德定位（网页定位需要 HTTPS 或 localhost）。'
    case 'PLUGIN_MISSING':
      return '高德定位插件没有加载成功。检查一下网络，以及高德控制台里的域名白名单；地图和出勤记录仍然可用。'
    case 'NO_KEY':
      return error.message
    default:
      return '定位失败，请稍后重试。定位不可用时，出勤和上鱼记录都不受影响。'
  }
}

/* ---------------------------- 实例管理 ---------------------------- */

let instance: AMap.Geolocation | null = null
let instancePromise: Promise<AMap.Geolocation> | null = null

/** 插件没跟着脚本一起下下来时，用官方 API 再要一次 */
function ensurePlugin(ns: typeof AMap, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new AmapLocationError(
          'PLUGIN_MISSING',
          '高德定位插件加载超时：AMap.Geolocation 没有就绪。',
          true,
        ),
      )
    }, timeoutMs)

    try {
      ns.plugin(['AMap.Geolocation'], () => {
        window.clearTimeout(timer)
        resolve()
      })
    } catch {
      window.clearTimeout(timer)
      reject(
        new AmapLocationError('PLUGIN_MISSING', '高德定位插件加载失败。', true),
      )
    }
  })
}

/**
 * 拿到唯一的定位实例。没配 Key、脚本没加载出来、插件没注册，都会在这里
 * 抛一个 `fatal` 的错误 —— 界面上会显示具体原因和「重新尝试定位」。
 */
async function getInstance(): Promise<AMap.Geolocation> {
  if (instance) return instance

  if (!instancePromise) {
    instancePromise = (async () => {
      const ns = await loadAmap()

      if (typeof ns.Geolocation !== 'function') {
        // 脚本 load 完了但没有定位插件：按官方方式再加载一次
        await ensurePlugin(ns)
      }
      if (typeof ns.Geolocation !== 'function') {
        throw new AmapLocationError(
          'PLUGIN_MISSING',
          '高德命名空间里没有定位插件 AMap.Geolocation。',
          true,
        )
      }

      const geo = new ns.Geolocation(GEO_OPTIONS)
      instance = geo
      return geo
    })().catch((error: unknown) => {
      // 失败不缓存，下次点「重新尝试定位」还能再试
      instancePromise = null
      throw toLocationError(error)
    })
  }

  return instancePromise
}

function toLocationError(error: unknown): AmapLocationError {
  if (error instanceof AmapLocationError) return error
  if (error instanceof Error) {
    // 加载器抛出来的基本是「没配 Key / 脚本没加载出来」
    return new AmapLocationError('NO_KEY', error.message, true)
  }
  return new AmapLocationError('FAILED', '定位失败，请稍后重试。', false)
}

/* --------------------------- 结果归一化 --------------------------- */

interface RawPosition {
  lng: number
  lat: number
}

function readPosition(value: unknown): RawPosition | null {
  if (!value) return null

  if (Array.isArray(value) && value.length >= 2) {
    const [lng, lat] = value
    if (typeof lng === 'number' && typeof lat === 'number') return { lng, lat }
    return null
  }

  if (typeof value === 'object') {
    const point = value as { getLng?: unknown; getLat?: unknown; lng?: unknown; lat?: unknown }
    const lng = typeof point.getLng === 'function' ? Number(point.getLng()) : point.lng
    const lat = typeof point.getLat === 'function' ? Number(point.getLat()) : point.lat
    if (typeof lng === 'number' && typeof lat === 'number') return { lng, lat }
  }

  return null
}

/** IP 定位及其它明显不是设备定位的结果 */
function readSource(result: AMap.GeolocationResult): LocationSource {
  const type = typeof result.location_type === 'string' ? result.location_type : ''
  return type === 'ip' || type === 'ipcity' ? 'ip' : 'device'
}

/**
 * 插件交出来的 position 到底是不是高德坐标（GCJ-02）。
 *
 * 这段判断是照着插件源码写的，不是猜的：
 * - `isConverted === true`：position 已经是高德坐标（IP 定位、支付宝 / UC 里的定位都走这条）
 * - `message` 里有 `Convert Success` / `No need convert`：插件转过或不需要转，是 GCJ-02
 * - `message` 里有 `Convert failed` / `Convert request failed`：转换没成功，
 *   position 还是浏览器给的原始 WGS84 —— 这种情况通常意味着安全密钥代理没配好
 * - 什么线索都没有时按「已是高德坐标」处理，这是插件默认行为下的正常结果
 */
function resolveConverted(result: AMap.GeolocationResult): boolean {
  if (result.isConverted === true) return true

  const message = typeof result.message === 'string' ? result.message : ''
  if (message.includes('Convert Success') || message.includes('No need convert')) {
    return true
  }
  if (
    message.includes('Convert failed') ||
    message.includes('Convert request failed')
  ) {
    return false
  }
  return true
}

/**
 * 最近一次读数里值得提醒用户的地方（例如坐标转换服务没通）。
 * 界面把它当软提示显示，不影响定位本身能不能用。
 */
let lastNote: string | null = null

export function getLastLocationNote(): string | null {
  return lastNote
}

function toLiveFix(result: AMap.GeolocationResult): LiveGeoPoint {
  const raw = readPosition(result.position)
  if (!raw || !Number.isFinite(raw.lng) || !Number.isFinite(raw.lat)) {
    throw new AmapLocationError(
      'POSITION_UNAVAILABLE',
      '高德返回的定位结果里没有可用坐标。',
      false,
    )
  }

  const converted = resolveConverted(result)
  lastNote = converted
    ? null
    : '高德坐标转换服务没通（通常是安全密钥代理没配好），这次定位用的是原始 GPS 坐标；地图上可能会偏几百米。'

  // 统一转成 WGS84 再交出去：插件给的已经是高德坐标时要转回来，
  // 没转成功时它本来就是 WGS84，直接用。全程只转这一次。
  const wgs = converted
    ? fromMapLngLat(raw.lng, raw.lat)
    : { latitude: raw.lat, longitude: raw.lng }

  const fix: LiveGeoPoint = {
    latitude: wgs.latitude,
    longitude: wgs.longitude,
    // 高德不返回时间戳，用收到读数的时间；IP 定位没有精度，如实留 NaN
    accuracy:
      typeof result.accuracy === 'number' && Number.isFinite(result.accuracy)
        ? result.accuracy
        : Number.NaN,
    recordedAt: Date.now(),
    source: readSource(result),
  }

  if (!hasCoordinates(fix)) {
    throw new AmapLocationError(
      'POSITION_UNAVAILABLE',
      '高德返回的坐标超出了有效范围。',
      false,
    )
  }

  return fix
}

/** 失败结果转成带中文说明的错误；插件里 info 是英文状态码 */
function readFailure(result: AMap.GeolocationResult): AmapLocationError {
  const info = typeof result.info === 'string' ? result.info : ''
  const detail = typeof result.message === 'string' ? result.message : ''

  if (info.includes('PERMISSION_DENIED') || result.code === 1) {
    return new AmapLocationError('PERMISSION_DENIED', detail || info, true)
  }
  if (info.includes('TIMEOUT') || result.code === 3) {
    return new AmapLocationError('TIMEOUT', detail || info, false)
  }
  if (info.includes('NOT_SUPPORT')) {
    return new AmapLocationError('NOT_SUPPORT', detail || info, true)
  }
  if (info.includes('POSITION_UNAVAILABLE') || result.code === 2) {
    return new AmapLocationError('POSITION_UNAVAILABLE', detail || info, false)
  }
  if (info.includes('INVALID_USER_KEY') || info.includes('USERKEY')) {
    return new AmapLocationError(
      'NO_KEY',
      '高德 Key 无效或没有通过域名白名单校验，定位服务用不了。地图底图可能还能显示。',
      true,
    )
  }
  return new AmapLocationError('FAILED', detail || info || '定位失败。', false)
}

/* ---------------------------- 单次定位 ---------------------------- */

/**
 * 点一次拿一次当前位置。IP 兜底的结果也会正常返回，
 * 只是 `source` 是 `'ip'`，上层据此标注并拒绝入库。
 */
export async function locateOnce(): Promise<LiveGeoPoint> {
  const geo = await getInstance()

  return new Promise<LiveGeoPoint>((resolve, reject) => {
    let settled = false

    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(
        new AmapLocationError(
          'TIMEOUT',
          '高德定位一直没回调（插件内部可能卡住了）。',
          false,
        ),
      )
    }, OVERALL_TIMEOUT_MS)

    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      run()
    }

    try {
      geo.getCurrentPosition((status, result) => {
        if (status === 'complete' && result && result.status !== 1) {
          finish(() => {
            try {
              resolve(toLiveFix(result))
            } catch (error: unknown) {
              reject(toLocationError(error))
            }
          })
          return
        }
        finish(() => reject(readFailure(result ?? {})))
      })
    } catch (error: unknown) {
      finish(() => reject(toLocationError(error)))
    }
  })
}

/* ---------------------------- 持续定位 ---------------------------- */

type FixHandler = (fix: LiveGeoPoint) => void
type FailHandler = (error: AmapLocationError) => void

let running = false
let timer: number | null = null
let onFix: FixHandler | null = null
let onFail: FailHandler | null = null
let latest: LiveGeoPoint | null = null

/**
 * 循环的「代号」。每停一次就加一，正在飞的那一跳回来一比对就知道自己过期了。
 *
 * 没有它会出现这样的事：定位请求还在飞的时候用户按了「暂停 → 继续」，
 * 旧的请求回来时看到 `running` 又是 true，就接着排下一次，
 * 而新循环也排了一次 —— 两条循环从此并行，谁也停不掉谁。
 */
let generation = 0

/**
 * 开始（或接管）持续定位。重复调用只会换回调，不会叠加第二条循环 ——
 * 这是「避免重复监听」的那道闸。
 */
export function startWatching(fixHandler: FixHandler, failHandler: FailHandler): void {
  onFix = fixHandler
  onFail = failHandler
  if (running) return

  running = true
  generation += 1
  void tick(generation)
}

async function tick(gen: number): Promise<void> {
  // 自己这一代已经作废（被停过或又被重开过）就不再往下走
  if (!running || gen !== generation) return

  try {
    const fix = await locateOnce()
    if (!running || gen !== generation) return
    latest = fix
    onFix?.(fix)
  } catch (error: unknown) {
    if (!running || gen !== generation) return
    const failure = toLocationError(error)
    onFail?.(failure)
    // 没配 Key、插件没加载出来这种重试也没用的，停下来等用户点重试，
    // 免得每 10 秒无意义地报一次同样的错
    if (failure.fatal && gen === generation) {
      stopWatching()
      return
    }
  }

  if (!running || gen !== generation) return
  timer = window.setTimeout(() => {
    void tick(gen)
  }, POLL_INTERVAL_MS)
}

/** 停止持续定位。已经拿到的读数不清空（界面还要显示「上次定位」） */
export function stopWatching(): void {
  running = false
  // 作废正在飞的那一跳：它回来时不会再排下一次
  generation += 1
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  onFix = null
  onFail = null
}

/** 最新读数（不受界面节流影响），一键上鱼写位置用它 */
export function getLatestFix(): LiveGeoPoint | null {
  return latest
}
