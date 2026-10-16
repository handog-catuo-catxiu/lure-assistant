/**
 * GPS 轨迹点的存储（IndexedDB 的 trackPoints 仓库）。
 *
 * 为什么不用 localStorage：一场出勤几百到几千个点，
 * 每秒都可能写一次，localStorage 既放不下也会拖慢主线程。
 *
 * 每个点的主键是自带的 id，同时按 sessionId 建索引，
 * 所以「取某场出勤的全部轨迹」和「删掉某场出勤的轨迹」都是一次索引查询。
 */
import { createId } from './ids'
import {
  TRACK_SESSION_INDEX,
  TRACK_STORE,
  idbRequest,
  idbTransactionDone,
} from './idb'
import type { GeoPoint, TrackPoint } from '../types/trip'

function asTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function asCoordinate(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null
}

/** 从仓库里读出来的东西可能是旧版本或坏数据，逐条校验后再用 */
function normalizeTrackPoint(value: unknown, fallbackSessionId: string): TrackPoint | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const latitude = asCoordinate(raw.latitude, 90)
  const longitude = asCoordinate(raw.longitude, 180)
  const recordedAt = asTime(raw.recordedAt)
  if (latitude === null || longitude === null || recordedAt === 0) return null

  const sessionId =
    typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : fallbackSessionId
  if (!sessionId) return null

  const accuracy =
    typeof raw.accuracy === 'number' && Number.isFinite(raw.accuracy) && raw.accuracy >= 0
      ? raw.accuracy
      : null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('trk'),
    sessionId,
    latitude,
    longitude,
    recordedAt,
    accuracy,
  }
}

/** 把一个真实定位读数写成轨迹点。id 在这里生成，调用方不用管 */
export function toTrackPoint(sessionId: string, position: GeoPoint): TrackPoint {
  return {
    id: createId('trk'),
    sessionId,
    latitude: position.latitude,
    longitude: position.longitude,
    recordedAt: position.recordedAt,
    accuracy: Number.isFinite(position.accuracy) ? position.accuracy : null,
  }
}

export async function putTrackPoint(point: TrackPoint): Promise<void> {
  await idbTransactionDone(TRACK_STORE, 'readwrite', (store) => {
    store.put(point)
  })
}

/** 写入多个点（批量补写 / 一次事务写一批，比逐个写省事） */
export async function putTrackPoints(points: TrackPoint[]): Promise<void> {
  if (points.length === 0) return
  await idbTransactionDone(TRACK_STORE, 'readwrite', (store) => {
    for (const point of points) store.put(point)
  })
}

/** 读取某场出勤的全部轨迹点，按采集时间升序 */
export async function getTrackPoints(sessionId: string): Promise<TrackPoint[]> {
  const records = await idbRequest<unknown[]>(TRACK_STORE, 'readonly', (store) =>
    store.index(TRACK_SESSION_INDEX).getAll(sessionId) as IDBRequest<unknown[]>,
  )

  const points: TrackPoint[] = []
  for (const record of records) {
    const point = normalizeTrackPoint(record, sessionId)
    if (point && point.sessionId === sessionId) points.push(point)
  }
  return points.sort((a, b) => a.recordedAt - b.recordedAt)
}

/** 某场出勤已经记了多少个点（不把整条轨迹读进内存） */
export async function countTrackPoints(sessionId: string): Promise<number> {
  return idbRequest<number>(TRACK_STORE, 'readonly', (store) =>
    store.index(TRACK_SESSION_INDEX).count(sessionId),
  )
}

/* --------------------- 记录开关（极小，放 localStorage） --------------------- */

const TRACK_PREF_KEY = 'luremate:track-pref:v1'

/** 这场出勤的轨迹记录开关。没记过返回 null，由调用方决定默认值 */
export function loadTrackPref(sessionId: string): boolean | null {
  try {
    const raw = localStorage.getItem(TRACK_PREF_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const entry = (parsed as Record<string, unknown>)[sessionId]
    return typeof entry === 'boolean' ? entry : null
  } catch {
    return null
  }
}

/**
 * 记住用户在这次出勤上的选择，刷新页面后不会偷偷把记录打开。
 * 只保留最近几场，免得这个键无限长大。
 */
export function saveTrackPref(sessionId: string, recordTrack: boolean): void {
  try {
    const raw = localStorage.getItem(TRACK_PREF_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const base: Record<string, boolean> =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, boolean>)
        : {}
    base[sessionId] = recordTrack

    const keys = Object.keys(base)
    const trimmed = keys.slice(Math.max(0, keys.length - 5))
    const next: Record<string, boolean> = {}
    for (const key of trimmed) next[key] = base[key]

    localStorage.setItem(TRACK_PREF_KEY, JSON.stringify(next))
  } catch {
    // 写不进去也不影响出勤，只是下次刷新会退回默认值
  }
}

/** 删除某场出勤的全部轨迹点 */
export async function deleteTrackPoints(sessionId: string): Promise<void> {
  const points = await getTrackPoints(sessionId)
  if (points.length === 0) return

  await idbTransactionDone(TRACK_STORE, 'readwrite', (store) => {
    for (const point of points) store.delete(point.id)
  })
}
