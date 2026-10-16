/**
 * 出勤系统在 localStorage 里的读写。
 *
 * 键名与装备（luremate:gear:v1）完全分开，各存各的，不会互相覆盖。
 * 读取时逐条做校验，坏掉的单条数据丢掉就行，不影响同一份里的其它记录。
 * 只有真的发生改动时才会写入，所以这里读到坏数据也不会把它冲掉。
 */
import { createId } from './ids'
import type { CatchRecord, Spot, TripSession, TripStatus } from '../types/trip'

export const SPOT_KEY = 'luremate:spots:v1'
export const TRIP_KEY = 'luremate:trips:v1'
export const CATCH_KEY = 'luremate:catches:v1'

function readRecords(key: string): unknown[] | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    // 隐私模式等读不到 localStorage 的场景：按空数据处理
    return null
  }
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 写入成功返回 true，失败（存储已满、隐私模式等）返回 false 由调用方提示 */
function writeRecords(key: string, records: unknown[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(records))
    return true
  } catch {
    return false
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

/** 经纬度：可以是负数（南半球 / 西经），只校验范围 */
function asCoordinate(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null
}

function asIdOrNull(value: unknown): string | null {
  const text = asText(value)
  return text ? text : null
}

/** 装备 id 列表：只留非空字符串并去重 */
function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
  return [...new Set(ids)]
}

/** 未来的可选计数字段：只有真的是非负整数才保留 */
function asCountOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function normalizeSpot(value: unknown): Spot | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const name = asText(raw.name).trim()
  if (!name) return null

  const createdAt = asTime(raw.createdAt) ?? Date.now()
  const spot: Spot = {
    id: asText(raw.id) || createId('spot'),
    name,
    note: asText(raw.note),
    createdAt,
    updatedAt: asTime(raw.updatedAt) ?? createdAt,
  }

  const latitude = asCoordinate(raw.latitude, 90)
  const longitude = asCoordinate(raw.longitude, 180)
  if (latitude !== null && longitude !== null) {
    spot.latitude = latitude
    spot.longitude = longitude

    // 地名是后来才加的字段，老数据没有也照常显示
    const placeName = asText(raw.placeName).trim()
    if (placeName) spot.placeName = placeName
  }
  return spot
}

function normalizeSession(value: unknown): TripSession | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const startedAt = asTime(raw.startedAt)
  if (startedAt === null) return null

  const endedAt = asTime(raw.endedAt)
  const status: TripStatus =
    raw.status === 'completed' || endedAt !== null ? 'completed' : 'active'

  const session: TripSession = {
    id: asText(raw.id) || createId('trip'),
    spotId: asText(raw.spotId),
    spotName: asText(raw.spotName),
    gearIds: asIdList(raw.gearIds),
    startedAt,
    // 进行中的出勤一定没有结束时间；已结束但缺结束时间时退回开始时间，时长不会变成负数
    endedAt: status === 'completed' ? (endedAt ?? startedAt) : null,
    status,
    createdAt: asTime(raw.createdAt) ?? startedAt,
    updatedAt: asTime(raw.updatedAt) ?? startedAt,
  }

  const source = raw.source
  if (source === 'web' || source === 'ios' || source === 'watch') {
    session.source = source
  }

  const steps = asCountOrUndefined(raw.steps)
  if (steps !== undefined) session.steps = steps
  const castCount = asCountOrUndefined(raw.castCount)
  if (castCount !== undefined) session.castCount = castCount

  return session
}

function normalizeCatch(value: unknown): CatchRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const sessionId = asText(raw.sessionId)
  const caughtAt = asTime(raw.caughtAt)
  // 没有归属出勤或没有上鱼时间的记录无法展示，直接丢掉
  if (!sessionId || caughtAt === null) return null

  const record: CatchRecord = {
    id: asText(raw.id) || createId('catch'),
    sessionId,
    spotId: asText(raw.spotId),
    caughtAt,
    createdAt: asTime(raw.createdAt) ?? caughtAt,
    updatedAt: asTime(raw.updatedAt) ?? caughtAt,
    species: asText(raw.species),
    lengthCm: asPositiveNumber(raw.lengthCm),
    weightG: asPositiveNumber(raw.weightG),
    rodId: asIdOrNull(raw.rodId),
    reelId: asIdOrNull(raw.reelId),
    lureId: asIdOrNull(raw.lureId),
    note: asText(raw.note),
  }

  const latitude = asCoordinate(raw.latitude, 90)
  const longitude = asCoordinate(raw.longitude, 180)
  if (latitude !== null && longitude !== null) {
    record.latitude = latitude
    record.longitude = longitude

    // locationRecordedAt 是位置读数的时间；locatedAt 是更早的字段名，读到也认
    const locationRecordedAt = asTime(raw.locationRecordedAt) ?? asTime(raw.locatedAt)
    if (locationRecordedAt !== null) record.locationRecordedAt = locationRecordedAt

    const locationAccuracy = asCountOrUndefined(raw.locationAccuracy)
    if (locationAccuracy !== undefined) record.locationAccuracy = locationAccuracy
  }
  return record
}

export function loadSpots(): Spot[] {
  const records = readRecords(SPOT_KEY)
  if (!records) return []
  return records
    .map(normalizeSpot)
    .filter((spot): spot is Spot => spot !== null)
}

export function saveSpots(spots: Spot[]): boolean {
  return writeRecords(SPOT_KEY, spots)
}

export function loadTrips(): TripSession[] {
  const records = readRecords(TRIP_KEY)
  if (!records) return []
  return records
    .map(normalizeSession)
    .filter((session): session is TripSession => session !== null)
}

export function saveTrips(sessions: TripSession[]): boolean {
  return writeRecords(TRIP_KEY, sessions)
}

export function loadCatches(): CatchRecord[] {
  const records = readRecords(CATCH_KEY)
  if (!records) return []
  return records
    .map(normalizeCatch)
    .filter((record): record is CatchRecord => record !== null)
}

export function saveCatches(catches: CatchRecord[]): boolean {
  return writeRecords(CATCH_KEY, catches)
}
