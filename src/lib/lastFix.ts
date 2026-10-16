/**
 * 最后一次**成功**的定位读数，单独存一份。
 *
 * 用途只有一个：这次定位还没回来（或者失败了）时，界面上能说实话——
 * 「上次定位是 14:32，在哪儿」，而不是留一片空白或者干脆显示一个假的坐标。
 * 它**不是**当前位置，界面上必须写清楚这一点，也绝不能拿它去当上鱼位置。
 *
 * 坐标仍然是手机 GPS 的原始值（WGS84），和高德地图要的 GCJ-02 不是一回事，
 * 上地图时统一由 coord.ts 转换，这里不做任何坐标系处理。
 */
import { LAST_FIX_MAX_AGE_MS, hasCoordinates } from './geo'
import type { GeoPoint, LiveGeoPoint } from '../types/trip'

export const LAST_FIX_KEY = 'luremate:last-fix:v1'

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 读上次的成功定位。没有、坏了、或者太旧（超过 LAST_FIX_MAX_AGE_MS）都返回 null。
 *
 * 返回 Promise 而不是直接读：调用方是个 effect，异步回来才不会在 effect 里
 * 同步 setState（也会被 react-hooks/set-state-in-effect 拦下来）。
 */
export async function loadLastFix(now: number = Date.now()): Promise<GeoPoint | null> {
  let raw: string | null
  try {
    raw = localStorage.getItem(LAST_FIX_KEY)
  } catch {
    // 隐私模式等读不到 localStorage：当作没有记录
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  const latitude = readNumber(record.latitude)
  const longitude = readNumber(record.longitude)
  const recordedAt = readNumber(record.recordedAt)
  const accuracy = readNumber(record.accuracy)

  if (latitude === null || longitude === null || recordedAt === null) return null
  if (!hasCoordinates({ latitude, longitude })) return null

  const age = now - recordedAt
  // 时间在未来（系统时钟被改过）或者太旧，都不拿出来充数
  if (age < 0 || age > LAST_FIX_MAX_AGE_MS) return null

  return {
    latitude,
    longitude,
    accuracy: accuracy ?? Number.NaN,
    recordedAt,
  }
}

/**
 * 记下一次成功的定位。写不进去（存储满了 / 隐私模式）就算了，不影响定位本身。
 * IP 粗略定位不记：它离你可能有几公里，当成「上次在哪儿」是误导。
 */
export async function saveLastFix(point: LiveGeoPoint): Promise<void> {
  if (!hasCoordinates(point)) return
  if (point.source === 'ip') return
  try {
    localStorage.setItem(
      LAST_FIX_KEY,
      JSON.stringify({
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        recordedAt: point.recordedAt,
      }),
    )
  } catch {
    // 忽略：这只是个显示用的参考值
  }
}

/** 清掉这份记录（用户主动清除位置信息时用） */
export async function clearLastFix(): Promise<void> {
  try {
    localStorage.removeItem(LAST_FIX_KEY)
  } catch {
    // 忽略
  }
}
