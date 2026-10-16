/**
 * GPS 相关的纯计算：距离、精度过滤、漂移抑制、展示格式。
 *
 * 这一层不认识 React，也不认识 IndexedDB，只吃坐标吐数字，
 * 方便单独验证规则，也方便将来 iOS / Watch 版本复用同一套判断。
 *
 * 一条贯穿始终的原则：**只处理真实采到的点**。
 * 定位中断的时间段不补点、不插值、不当作已走过的距离。
 */
import type { GeoPoint, LiveGeoPoint, LocationSource, TrackPoint } from '../types/trip'

/* ------------------------------- 采集参数 ------------------------------- */

/**
 * 采样间隔（毫秒）。定位循环每 10 秒取一次读数（见 lib/amap/geolocation.ts），
 * 这里是采点的最小接受间隔：比这更密的点直接丢掉，省电也省存储。
 */
export const CAPTURE_MIN_INTERVAL_MS = 4_000

/** 精度差于这个值（米）的点不进轨迹：手机基站定位动辄几百米，画出来是乱线 */
export const MAX_TRACK_ACCURACY_M = 60

/** 位移小于这个值（米）视为原地抖动，不新增轨迹点 */
export const MIN_MOVE_M = 4

/** 由两点间距离与时间推出的速度上限（米/秒）；超过就当成跳点丢掉 */
export const MAX_SPEED_MPS = 12

/** 相邻两个轨迹点间隔超过这个时间（毫秒）视为「定位断点」，不连线、不算距离 */
export const TRACK_GAP_MS = 5 * 60_000

/** 一键上鱼时，定位新鲜度要求：比这更旧的定位不写进渔获 */
export const CATCH_LOCATION_MAX_AGE_MS = 90_000

/** 一键上鱼时能接受的定位精度上限（米） */
export const CATCH_LOCATION_MAX_ACCURACY_M = 120

/**
 * 定位读数超过这个时间（毫秒）就不再算「现在的」位置。
 * 界面上仍然可以显示它，但必须写成「上次定位」并带上时间，
 * 不能把它摆在「当前坐标」的位置上。
 */
export const FIX_FRESH_MS = 60_000

/**
 * 上次成功定位的位置最多保留这么久（毫秒）。再旧的位置连当参考都没意义了，
 * 与其显示一个几天前的坐标，不如老实说「还没定位」。
 */
export const LAST_FIX_MAX_AGE_MS = 24 * 60 * 60_000

/** 轨迹至少要有这么多点才值得画线 */
export const MIN_TRACK_POINTS = 2

/** 距离统计至少要有这么多点，否则显示「数据不足」 */
export const MIN_DISTANCE_POINTS = 3

/* ------------------------------- 距离计算 ------------------------------- */

const EARTH_RADIUS_M = 6_371_008.8
const DEG_TO_RAD = Math.PI / 180

/** 两个经纬度之间的大圆距离（米），Haversine 公式 */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = (bLat - aLat) * DEG_TO_RAD
  const dLng = (bLng - aLng) * DEG_TO_RAD
  const lat1 = aLat * DEG_TO_RAD
  const lat2 = bLat * DEG_TO_RAD

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/* ------------------------------- 轨迹过滤 ------------------------------- */

export type TrackRejectReason = 'inaccurate' | 'too-soon' | 'jitter' | 'jump'

export interface TrackFilterResult {
  /** 是否接受这个点 */
  keep: boolean
  /** 被拒绝的原因 */
  reason?: TrackRejectReason
  /** 与上一个保留点的距离（米），没有上一个点为 null */
  distanceM: number | null
}

/** 经纬度是否合法。轨迹点和定位读数都能用，所以只要求这两个字段存在 */
interface CoordinateLike {
  latitude?: number | null
  longitude?: number | null
}

export function hasCoordinates(value: CoordinateLike): boolean {
  const { latitude, longitude } = value
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  )
}

/**
 * 判断一个新的定位点要不要进轨迹。previous 是上一个**被保留**的点。
 *
 * 依次挡掉：坐标非法 / 精度过差 / 间隔太密 / 原地抖动 / 速度不合理的跳点。
 */
export function filterTrackPoint(
  candidate: GeoPoint,
  previous: TrackPoint | null,
): TrackFilterResult {
  if (!hasCoordinates(candidate)) {
    return { keep: false, reason: 'inaccurate', distanceM: null }
  }
  if (Number.isFinite(candidate.accuracy) && candidate.accuracy > MAX_TRACK_ACCURACY_M) {
    return { keep: false, reason: 'inaccurate', distanceM: null }
  }
  if (!previous) return { keep: true, distanceM: null }

  const dt = candidate.recordedAt - previous.recordedAt
  const distanceM = haversineMeters(
    previous.latitude,
    previous.longitude,
    candidate.latitude,
    candidate.longitude,
  )

  // 时间没有前进说明是同一时刻的重复回调
  if (dt <= 0) return { keep: false, reason: 'too-soon', distanceM }

  // 离上一个点太近，先看是不是原地抖动；确实走动了才算新点
  if (distanceM < MIN_MOVE_M) {
    if (dt < CAPTURE_MIN_INTERVAL_MS) {
      return { keep: false, reason: 'too-soon', distanceM }
    }
    return { keep: false, reason: 'jitter', distanceM }
  }

  if (dt < CAPTURE_MIN_INTERVAL_MS) {
    return { keep: false, reason: 'too-soon', distanceM }
  }

  // 时间断点之后的第一点不做速度判断：中间可能走了很远，
  // 拿断点前后的两点算速度一定会误判成跳点
  if (dt <= TRACK_GAP_MS && distanceM / (dt / 1000) > MAX_SPEED_MPS) {
    return { keep: false, reason: 'jump', distanceM }
  }

  return { keep: true, distanceM }
}

/* ------------------------------- 距离统计 ------------------------------- */

export interface TrackSummary {
  /** 参与统计的轨迹点数量 */
  pointCount: number
  /** 时间跨度（毫秒） */
  durationMs: number
  /**
   * 已记录的移动距离（米）。数据不足时为 null。
   * 这是「GPS 记录到的距离」，不等于真实总行走距离。
   */
  meters: number | null
  /** 定位断点的段数：断点之间的路程是未知的，不计入距离 */
  breakCount: number
  /** 已经算出距离的路段数 */
  segmentCount: number
  /** 是否有足够的数据画一条真实轨迹 */
  hasTrack: boolean
}

/** 把轨迹点排好序（按采集时间升序），顺带丢掉坐标非法的点 */
export function sortTrackPoints(points: TrackPoint[]): TrackPoint[] {
  return points
    .filter((point) => hasCoordinates(point))
    .slice()
    .sort((a, b) => a.recordedAt - b.recordedAt)
}

/**
 * 统计一条轨迹：总距离、断点数量、是否够画线。
 *
 * 距离只累加「连续且合理」的路段：
 * - 时间断点（> TRACK_GAP_MS）不连、不算
 * - 位移小于 MIN_MOVE_M 的抖动不算
 * - 速度超过 MAX_SPEED_MPS 的跳点不算
 */
export function summarizeTrack(input: TrackPoint[]): TrackSummary {
  const points = sortTrackPoints(input)
  const empty: TrackSummary = {
    pointCount: points.length,
    durationMs: 0,
    meters: null,
    breakCount: 0,
    segmentCount: 0,
    hasTrack: points.length >= MIN_TRACK_POINTS,
  }
  if (points.length === 0) return empty

  const first = points[0]
  const last = points[points.length - 1]
  const durationMs = last.recordedAt - first.recordedAt

  let meters = 0
  let breakCount = 0
  let segmentCount = 0

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]
    const current = points[i]
    const dt = current.recordedAt - previous.recordedAt
    const distance = haversineMeters(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    )

    if (dt > TRACK_GAP_MS) {
      // 定位中断：这一段是未知路程，明确断开
      breakCount += 1
      continue
    }
    if (distance < MIN_MOVE_M) continue
    if (dt > 0 && distance / (dt / 1000) > MAX_SPEED_MPS) continue

    meters += distance
    segmentCount += 1
  }

  return {
    pointCount: points.length,
    durationMs,
    meters:
      points.length < MIN_DISTANCE_POINTS || segmentCount === 0 ? null : meters,
    breakCount,
    segmentCount,
    hasTrack: points.length >= MIN_TRACK_POINTS,
  }
}

/**
 * 把轨迹切成连续的线段：时间跨度超过 TRACK_GAP_MS 的地方断开。
 * 地图按这个数组逐段画线，断点处不会出现横跨半个屏幕的直线。
 */
export function splitTrackSegments(points: TrackPoint[]): TrackPoint[][] {
  const sorted = sortTrackPoints(points)
  const segments: TrackPoint[][] = []
  let current: TrackPoint[] = []

  for (const point of sorted) {
    const previous = current[current.length - 1]
    if (previous && point.recordedAt - previous.recordedAt > TRACK_GAP_MS) {
      if (current.length > 0) segments.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length > 0) segments.push(current)
  return segments.filter((segment) => segment.length > 0)
}

/* ------------------------------- 展示格式 ------------------------------- */

/** 经纬度：30.123456°N, 120.123456°E */
export function formatCoordinate(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(6)}°${latitude >= 0 ? 'N' : 'S'}`
  const lng = `${Math.abs(longitude).toFixed(6)}°${longitude >= 0 ? 'E' : 'W'}`
  return `${lat}, ${lng}`
}

/** 地图弹窗里更短的写法：30.12345, 120.12345 */
export function formatCoordinateShort(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

/** 精度：±12 米 */
export function formatAccuracy(accuracy: number | null | undefined): string {
  if (accuracy === null || accuracy === undefined || !Number.isFinite(accuracy)) {
    return '精度未知'
  }
  if (accuracy >= 1000) return `±${(accuracy / 1000).toFixed(1)} 公里`
  return `±${Math.round(accuracy)} 米`
}

/**
 * 这条定位读数离现在多久了：刚刚 / 42 秒前 / 3 分钟前 / 2 小时前。
 * 用来给「上次定位」标一个一眼能看懂的年龄。
 */
export function formatFixAge(recordedAt: number, now = Date.now()): string {
  const age = now - recordedAt
  if (!Number.isFinite(age)) return '时间未知'
  if (age < 0) return '刚刚'
  if (age < 10_000) return '刚刚'
  if (age < 60_000) return `${Math.round(age / 1000)} 秒前`
  if (age < 60 * 60_000) return `${Math.round(age / 60_000)} 分钟前`
  if (age < 24 * 60 * 60_000) return `${Math.round(age / 60 / 60_000)} 小时前`
  return `${Math.round(age / (24 * 60 * 60_000))} 天前`
}

/** 这条读数还算不算「现在的」位置（年龄在 FIX_FRESH_MS 以内） */
export function isFixFresh(recordedAt: number, now = Date.now()): boolean {
  const age = now - recordedAt
  return age >= 0 && age <= FIX_FRESH_MS
}

/** 已记录距离：320 米 / 1.24 公里 */
export function formatDistance(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return '—'
  if (meters < 1000) return `${Math.round(meters)} 米`
  return `${(meters / 1000).toFixed(2)} 公里`
}

/** 距离越远，越说明这是估算：给出一句说明用 */
export function describeDistanceSource(meters: number | null): string {
  if (meters === null) return '轨迹点还不够，暂时算不出距离'
  return '按 GPS 已记录的轨迹点累加，不含定位中断期间的路程'
}

/**
 * 判断某个定位点是否够新鲜、够准、来源是否可信，可以写进渔获。
 * now 默认取当前时间，调用方就不用自己取钟（组件里读时钟会触发 react-hooks/purity）。
 */
export function isLocationUsableForCatch(
  point: LiveGeoPoint | null,
  now: number = Date.now(),
): boolean {
  if (!point) return false
  // IP 粗略定位只能在地图上当参考：它离你可能有几公里，
  // 记成上鱼位置是编数据，不是记录
  if (!isDeviceLocation(point)) return false
  if (!hasCoordinates(point)) return false
  // 精度未知的读数算不上「够准」，宁可留空也不写一个说不清多准的位置
  if (!Number.isFinite(point.accuracy)) return false
  if (point.accuracy > CATCH_LOCATION_MAX_ACCURACY_M) return false
  const age = now - point.recordedAt
  return age >= 0 && age <= CATCH_LOCATION_MAX_AGE_MS
}

/** 这条读数是不是设备定位（不是 IP 粗略定位）—— 只有设备定位才允许入库 */
export function isDeviceLocation(point: { source?: LocationSource }): boolean {
  return point.source !== 'ip'
}

/** 「这条位置是怎么来的」，界面上的说法统一从这里取 */
export function describeLocationSource(source: LocationSource): string {
  return source === 'ip' ? 'IP 大致位置' : '设备定位'
}

/** 定位状态的展示文案 */
export type GeoStatus =
  | 'idle'
  | 'unsupported'
  | 'locating'
  | 'watching'
  | 'paused'
  | 'denied'
  | 'error'

export interface GeoStatusText {
  label: string
  /** 徽章配色：ok = 正常，wait = 进行中，off = 已暂停/未开始，error = 有问题 */
  tone: 'ok' | 'wait' | 'off' | 'error'
}

export function describeGeoStatus(
  status: GeoStatus,
  options: { recording?: boolean; ip?: boolean } = {},
): GeoStatusText {
  // IP 定位是「有结果但不可信」，优先把这个事实摆出来，
  // 不然一个几公里外的点会被当成定位成功
  if (options.ip && (status === 'watching' || status === 'locating')) {
    return { label: '仅 IP 大致位置', tone: 'wait' }
  }

  switch (status) {
    case 'locating':
      return { label: '定位中…', tone: 'wait' }
    case 'watching':
      return options.recording
        ? { label: '正在记录轨迹', tone: 'ok' }
        : { label: '定位正常', tone: 'ok' }
    case 'paused':
      return { label: '已暂停定位', tone: 'off' }
    case 'denied':
      return { label: '未获得定位权限', tone: 'error' }
    case 'unsupported':
      return { label: '此浏览器不支持定位', tone: 'error' }
    case 'error':
      return { label: '定位失败', tone: 'error' }
    default:
      return { label: '尚未定位', tone: 'off' }
  }
}
