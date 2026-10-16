/**
 * 出勤系统的业务规则。
 *
 * 这里的函数都是纯粹的「进数据、出数据」，不碰 React、不碰 localStorage，
 * 页面和存储层都只是调用它们。这样将来 iOS / Apple Watch 版本要重新实现时，
 * 需要对齐的规则都集中在这一个文件里。
 */
import { createId } from './ids'
import type { GearItem } from '../types/gear'
import type {
  CatchDraft,
  CatchRecord,
  GeoPoint,
  Spot,
  SpotDraft,
  TripSession,
} from '../types/trip'

/**
 * 标点位置：草稿里带了完整经纬度就写入，没带就保持原样。
 * 编辑标点名不会把已经记录的位置（和地名）弄丢。
 */
function withSpotLocation(spot: Spot, draft: SpotDraft): Spot {
  if (typeof draft.latitude !== 'number' || typeof draft.longitude !== 'number') {
    return spot
  }

  const next: Spot = { ...spot, latitude: draft.latitude, longitude: draft.longitude }
  const placeName = draft.placeName?.trim()
  if (placeName) next.placeName = placeName
  return next
}

export function createSpot(draft: SpotDraft, now = Date.now()): Spot {
  const spot: Spot = {
    id: createId('spot'),
    name: draft.name,
    note: draft.note,
    createdAt: now,
    updatedAt: now,
  }
  return withSpotLocation(spot, draft)
}

export function applySpotDraft(spot: Spot, draft: SpotDraft, now = Date.now()): Spot {
  const next: Spot = { ...spot, name: draft.name, note: draft.note, updatedAt: now }
  return withSpotLocation(next, draft)
}

/** 正在进行的出勤。同一时间最多只有一场，所以取第一条即可 */
export function findActiveSession(sessions: TripSession[]): TripSession | null {
  return sessions.find((session) => session.status === 'active') ?? null
}

export function createTripSession(
  input: { spotId: string; spotName: string; gearIds: string[] },
  now = Date.now(),
): TripSession {
  return {
    id: createId('trip'),
    spotId: input.spotId,
    spotName: input.spotName,
    gearIds: [...new Set(input.gearIds)],
    startedAt: now,
    endedAt: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    source: 'web',
  }
}

/** 结束出勤：写入真实的结束时间并改状态 */
export function endTripSession(session: TripSession, now = Date.now()): TripSession {
  return { ...session, endedAt: now, status: 'completed', updatedAt: now }
}

/** 出勤途中增删「本次携带的装备」 */
export function changeSessionGear(
  session: TripSession,
  gearIds: string[],
  now = Date.now(),
): TripSession {
  return { ...session, gearIds: [...new Set(gearIds)], updatedAt: now }
}

/** 把一次定位读数写进渔获的位置字段 */
export function withCatchLocation(record: CatchRecord, location: GeoPoint): CatchRecord {
  return {
    ...record,
    latitude: location.latitude,
    longitude: location.longitude,
    locationRecordedAt: location.recordedAt,
    locationAccuracy: Number.isFinite(location.accuracy) ? location.accuracy : undefined,
  }
}

/** 清除渔获上的位置（连同位置的时间和精度一起） */
export function clearCatchLocation(record: CatchRecord): CatchRecord {
  const next: CatchRecord = { ...record }
  delete next.latitude
  delete next.longitude
  delete next.locationRecordedAt
  delete next.locationAccuracy
  return next
}

/**
 * 一键上鱼：先只写必填字段就落库，鱼种、照片、长度等之后随时补充。
 * caughtAt 取当前真实时间，精确到秒。
 *
 * location 只在「此刻手上就有新鲜且合格的定位」时才传进来，
 * 它记录的是上鱼那一刻的位置，不会用标点坐标顶替。
 */
export function createCatch(
  session: TripSession,
  location: GeoPoint | null = null,
  now = Date.now(),
): CatchRecord {
  const record: CatchRecord = {
    id: createId('catch'),
    sessionId: session.id,
    spotId: session.spotId,
    caughtAt: now,
    createdAt: now,
    updatedAt: now,
    species: '',
    lengthCm: null,
    weightG: null,
    rodId: null,
    reelId: null,
    lureId: null,
    note: '',
  }
  return location ? withCatchLocation(record, location) : record
}

/**
 * 把补充界面里填的内容合并进已有渔获。
 * draft.location 三态：undefined 保持原样 / null 清除 / GeoPoint 写入新位置。
 */
export function applyCatchDraft(
  record: CatchRecord,
  draft: CatchDraft,
  now = Date.now(),
): CatchRecord {
  const next: CatchRecord = {
    ...record,
    species: draft.species,
    lengthCm: draft.lengthCm,
    weightG: draft.weightG,
    rodId: draft.rodId,
    reelId: draft.reelId,
    lureId: draft.lureId,
    note: draft.note,
    updatedAt: now,
  }

  if (draft.location === undefined) return next
  if (draft.location === null) return clearCatchLocation(next)
  return withCatchLocation(next, draft.location)
}

export interface NumberParseResult {
  /** 合法数值；未填写为 null */
  value: number | null
  /** 是否通过校验。未填写也算通过（长度、重量都是选填） */
  ok: boolean
}

/** 长度 / 重量校验：空算「未填写」，其余必须是 0 以上且不超过上限的数字 */
export function parsePositiveNumber(input: string, max: number): NumberParseResult {
  const text = input.trim()
  if (!text) return { value: null, ok: true }

  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    return { value: null, ok: false }
  }
  return { value, ok: true }
}

/** 某场出勤的渔获，最新的排在前面 */
export function catchesOfSession(
  catches: CatchRecord[],
  sessionId: string,
): CatchRecord[] {
  return catches
    .filter((record) => record.sessionId === sessionId)
    .sort((a, b) => b.caughtAt - a.caughtAt)
}

/** 历史出勤列表：按开始时间倒序 */
export function sortSessionsByStartDesc(sessions: TripSession[]): TripSession[] {
  return [...sessions].sort((a, b) => b.startedAt - a.startedAt)
}

/** 装备引用。装备被删除后仍然给出一份可显示的文案，界面不会崩 */
export interface GearRef {
  id: string
  name: string
  brand: string
  deleted: boolean
}

export function resolveGear(
  items: GearItem[],
  id: string | null | undefined,
): GearRef | null {
  if (!id) return null

  const item = items.find((gear) => gear.id === id)
  if (!item) return { id, name: '装备已删除', brand: '', deleted: true }
  return { id: item.id, name: item.name, brand: item.brand, deleted: false }
}

/** 一场出勤带出去的装备，保持开始时的选择顺序，已删除的也列出来 */
export function resolveSessionGear(items: GearItem[], gearIds: string[]): GearRef[] {
  return gearIds
    .map((id) => resolveGear(items, id))
    .filter((ref): ref is GearRef => ref !== null)
}
