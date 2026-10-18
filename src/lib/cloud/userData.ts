/**
 * 个人数据在 PostgreSQL 行和本地对象之间的映射。
 *
 * 本地 ID 原样保留（装备 / 标点 / 出勤 / 渔获之间靠这些 ID 互相引用），
 * 不重新编号。官方图鉴 id 只作为可选关联保留，不复制官方产品内容。
 */
import type { GearCategory, GearItem, GearSpec } from '../../types/gear'
import type {
  CatchRecord,
  Spot,
  TrackPoint,
  TripSession,
  TripSource,
  TripStatus,
} from '../../types/trip'
import type { RecordSyncMeta, SyncEntity } from '../sync/meta'

export interface RemoteTimestamps {
  updated_at?: string | null
  deleted_at?: string | null
}

export interface RemoteRecord<T> {
  record: T | null
  deleted: boolean
  clientUpdatedAt: number
  serverUpdatedAt: string | null
}

export function serverTime(row: RemoteTimestamps): string | null {
  return typeof row.updated_at === 'string' ? row.updated_at : null
}

export function remoteDeleted(row: RemoteTimestamps): boolean {
  return typeof row.deleted_at === 'string' && row.deleted_at.length > 0
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBool(value: unknown): boolean {
  return value === true
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function ms(value: unknown, fallback = 0): number {
  const number = asNumber(value)
  return number !== null && number > 0 ? number : fallback
}

function isoMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/* -------------------------------- 装备 -------------------------------- */

export interface UserGearRow extends RemoteTimestamps {
  user_id: string
  id: string
  catalog_id: string | null
  category: GearCategory
  brand: string
  name: string
  spec: unknown
  note: string
  purchased_at: string
  favorite: boolean
  show_image_on_home: boolean
  image_path: string | null
  image_updated_at: number | null
  client_updated_at: number
  device_id: string
  created_at?: string
}

export interface GearRowInput {
  user_id: string
  id: string
  catalog_id: string | null
  category: GearCategory
  brand: string
  name: string
  spec: GearSpec
  note: string
  purchased_at: string
  favorite: boolean
  show_image_on_home: boolean
  image_path: string | null
  image_updated_at: number | null
  client_updated_at: number
  device_id: string
}

export function buildGearRow(
  gear: GearItem,
  meta: RecordSyncMeta,
  uid: string,
  deviceId: string,
  image: { path: string | null; updatedAt: number | null },
): GearRowInput {
  return {
    user_id: uid,
    id: gear.id,
    catalog_id: gear.catalogId ?? null,
    category: gear.category,
    brand: gear.brand,
    name: gear.name,
    spec: gear.spec,
    note: gear.note,
    purchased_at: gear.purchasedAt,
    favorite: gear.favorite,
    show_image_on_home: gear.showImageOnHome,
    image_path: image.path,
    image_updated_at: image.updatedAt,
    client_updated_at: meta.clientUpdatedAt,
    device_id: deviceId,
  }
}

export function mapGearRow(row: UserGearRow): RemoteRecord<GearItem> {
  const deleted = remoteDeleted(row)
  if (deleted) {
    return {
      record: null,
      deleted: true,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const name = asString(row.name).trim()
  const category = row.category
  if (!name || !['rod', 'reel', 'lure', 'accessory'].includes(category)) {
    return {
      record: null,
      deleted: false,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const spec: GearSpec = {}
  if (typeof row.spec === 'object' && row.spec !== null) {
    const source = row.spec as Record<string, unknown>
    for (const key of ['length', 'action', 'model', 'ratio', 'lureType', 'weight', 'accessoryType'] as const) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) spec[key] = value
    }
  }

  return {
    record: {
      id: row.id,
      name,
      category,
      brand: asString(row.brand),
      spec,
      note: asString(row.note),
      purchasedAt: asString(row.purchased_at),
      favorite: asBool(row.favorite),
      catalogId: row.catalog_id ?? undefined,
      showImageOnHome: asBool(row.show_image_on_home),
    },
    deleted: false,
    clientUpdatedAt: ms(row.client_updated_at),
    serverUpdatedAt: serverTime(row),
  }
}

export function imagePathOfGear(row: UserGearRow): {
  path: string | null
  updatedAt: number | null
} {
  return {
    path: row.image_path ?? null,
    updatedAt: asNumber(row.image_updated_at),
  }
}

/* -------------------------------- 标点 -------------------------------- */

export interface UserSpotRow extends RemoteTimestamps {
  user_id: string
  id: string
  name: string
  note: string
  latitude: number | null
  longitude: number | null
  place_name: string | null
  client_created_at: number
  client_updated_at: number
  created_at?: string
}

export interface SpotRowInput {
  user_id: string
  id: string
  name: string
  note: string
  latitude: number | null
  longitude: number | null
  place_name: string | null
  client_created_at: number
  client_updated_at: number
}

export function buildSpotRow(
  spot: Spot,
  meta: RecordSyncMeta,
  uid: string,
): SpotRowInput {
  return {
    user_id: uid,
    id: spot.id,
    name: spot.name,
    note: spot.note,
    latitude: spot.latitude ?? null,
    longitude: spot.longitude ?? null,
    place_name: spot.placeName ?? null,
    client_created_at: spot.createdAt,
    client_updated_at: meta.clientUpdatedAt,
  }
}

export function mapSpotRow(row: UserSpotRow): RemoteRecord<Spot> {
  const deleted = remoteDeleted(row)
  if (deleted) {
    return {
      record: null,
      deleted: true,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const name = asString(row.name).trim()
  if (!name) {
    return {
      record: null,
      deleted: false,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const createdAt =
    ms(row.client_created_at) || isoMs(row.created_at) || Date.now()
  const spot: Spot = {
    id: row.id,
    name,
    note: asString(row.note),
    createdAt,
    updatedAt: ms(row.client_updated_at) || createdAt,
  }
  if (asNumber(row.latitude) !== null && asNumber(row.longitude) !== null) {
    spot.latitude = row.latitude as number
    spot.longitude = row.longitude as number
    if (row.place_name) spot.placeName = row.place_name
  }

  return {
    record: spot,
    deleted: false,
    clientUpdatedAt: ms(row.client_updated_at) || createdAt,
    serverUpdatedAt: serverTime(row),
  }
}

/* -------------------------------- 出勤 -------------------------------- */

export interface UserTripRow extends RemoteTimestamps {
  user_id: string
  id: string
  spot_id: string
  spot_name: string
  gear_ids: unknown
  started_at: number
  ended_at: number | null
  status: TripStatus
  source: TripSource | null
  steps: number | null
  cast_count: number | null
  client_created_at: number
  client_updated_at: number
  created_at?: string
}

export interface TripRowInput {
  user_id: string
  id: string
  spot_id: string
  spot_name: string
  gear_ids: string[]
  started_at: number
  ended_at: number | null
  status: TripStatus
  source: TripSource | null
  steps: number | null
  cast_count: number | null
  client_created_at: number
  client_updated_at: number
}

export function buildTripRow(
  session: TripSession,
  meta: RecordSyncMeta,
  uid: string,
): TripRowInput {
  return {
    user_id: uid,
    id: session.id,
    spot_id: session.spotId,
    spot_name: session.spotName,
    gear_ids: session.gearIds,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    status: session.status,
    source: session.source ?? null,
    steps: session.steps ?? null,
    cast_count: session.castCount ?? null,
    client_created_at: session.createdAt,
    client_updated_at: meta.clientUpdatedAt,
  }
}

export function mapTripRow(row: UserTripRow): RemoteRecord<TripSession> {
  const deleted = remoteDeleted(row)
  if (deleted) {
    return {
      record: null,
      deleted: true,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const startedAt = ms(row.started_at)
  if (!startedAt) {
    return {
      record: null,
      deleted: false,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const endedAt = ms(row.ended_at)
  const status: TripStatus =
    row.status === 'completed' || endedAt > 0 ? 'completed' : 'active'
  const gearIds = [
    ...new Set(
      asArray(row.gear_ids).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  ]

  const session: TripSession = {
    id: row.id,
    spotId: asString(row.spot_id),
    spotName: asString(row.spot_name),
    gearIds,
    startedAt,
    endedAt: status === 'completed' ? endedAt || startedAt : null,
    status,
    createdAt: ms(row.client_created_at) || startedAt,
    updatedAt: ms(row.client_updated_at) || startedAt,
  }
  if (row.source === 'web' || row.source === 'ios' || row.source === 'watch') {
    session.source = row.source
  }
  if (asNumber(row.steps) !== null) session.steps = row.steps as number
  if (asNumber(row.cast_count) !== null) session.castCount = row.cast_count as number

  return {
    record: session,
    deleted: false,
    clientUpdatedAt: ms(row.client_updated_at) || startedAt,
    serverUpdatedAt: serverTime(row),
  }
}

/* -------------------------------- 渔获 -------------------------------- */

export interface UserCatchRow extends RemoteTimestamps {
  user_id: string
  id: string
  session_id: string
  spot_id: string
  caught_at: number
  species: string
  length_cm: number | null
  weight_g: number | null
  rod_id: string | null
  reel_id: string | null
  lure_id: string | null
  note: string
  latitude: number | null
  longitude: number | null
  location_recorded_at: number | null
  location_accuracy: number | null
  client_created_at: number
  client_updated_at: number
  created_at?: string
}

export interface CatchRowInput {
  user_id: string
  id: string
  session_id: string
  spot_id: string
  caught_at: number
  species: string
  length_cm: number | null
  weight_g: number | null
  rod_id: string | null
  reel_id: string | null
  lure_id: string | null
  note: string
  latitude: number | null
  longitude: number | null
  location_recorded_at: number | null
  location_accuracy: number | null
  client_created_at: number
  client_updated_at: number
}

export function buildCatchRow(
  record: CatchRecord,
  meta: RecordSyncMeta,
  uid: string,
): CatchRowInput {
  return {
    user_id: uid,
    id: record.id,
    session_id: record.sessionId,
    spot_id: record.spotId,
    caught_at: record.caughtAt,
    species: record.species,
    length_cm: record.lengthCm,
    weight_g: record.weightG,
    rod_id: record.rodId,
    reel_id: record.reelId,
    lure_id: record.lureId,
    note: record.note,
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
    location_recorded_at: record.locationRecordedAt ?? null,
    location_accuracy: record.locationAccuracy ?? null,
    client_created_at: record.createdAt,
    client_updated_at: meta.clientUpdatedAt,
  }
}

function positiveOrNull(value: unknown): number | null {
  const number = asNumber(value)
  return number !== null && number > 0 ? number : null
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function mapCatchRow(row: UserCatchRow): RemoteRecord<CatchRecord> {
  const deleted = remoteDeleted(row)
  if (deleted) {
    return {
      record: null,
      deleted: true,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const caughtAt = ms(row.caught_at)
  if (!caughtAt || !asString(row.session_id)) {
    return {
      record: null,
      deleted: false,
      clientUpdatedAt: ms(row.client_updated_at),
      serverUpdatedAt: serverTime(row),
    }
  }

  const record: CatchRecord = {
    id: row.id,
    sessionId: row.session_id,
    spotId: asString(row.spot_id),
    caughtAt,
    createdAt: ms(row.client_created_at) || caughtAt,
    updatedAt: ms(row.client_updated_at) || caughtAt,
    species: asString(row.species),
    lengthCm: positiveOrNull(row.length_cm),
    weightG: positiveOrNull(row.weight_g),
    rodId: optionalId(row.rod_id),
    reelId: optionalId(row.reel_id),
    lureId: optionalId(row.lure_id),
    note: asString(row.note),
  }

  if (asNumber(row.latitude) !== null && asNumber(row.longitude) !== null) {
    record.latitude = row.latitude as number
    record.longitude = row.longitude as number
    const recordedAt = ms(row.location_recorded_at)
    if (recordedAt) record.locationRecordedAt = recordedAt
    if (asNumber(row.location_accuracy) !== null) {
      record.locationAccuracy = row.location_accuracy as number
    }
  }

  return {
    record,
    deleted: false,
    clientUpdatedAt: ms(row.client_updated_at) || caughtAt,
    serverUpdatedAt: serverTime(row),
  }
}

/* ------------------------------- 轨迹点 ------------------------------- */

export interface UserTrackRow extends RemoteTimestamps {
  user_id: string
  id: string
  session_id: string
  latitude: number
  longitude: number
  recorded_at: number
  accuracy: number | null
  client_updated_at: number
  created_at?: string
}

export function mapTrackRow(row: UserTrackRow): TrackPoint | null {
  const latitude = asNumber(row.latitude)
  const longitude = asNumber(row.longitude)
  const recordedAt = ms(row.recorded_at)
  if (latitude === null || longitude === null || !recordedAt) return null
  if (!asString(row.session_id)) return null

  return {
    id: row.id,
    sessionId: row.session_id,
    latitude,
    longitude,
    recordedAt,
    accuracy: asNumber(row.accuracy),
  }
}

/* ------------------------------- 偏好 / 图片 ------------------------------- */

export interface UserPrefRow extends RemoteTimestamps {
  user_id: string
  /** 偏好键，例如 home.refSpot / home.water */
  id: string
  value: unknown
  client_updated_at: number
}

export interface UserImageRow extends RemoteTimestamps {
  user_id: string
  /** gear:<gearId>:original / catch:<catchId>:original */
  id: string
  entity_type: 'gear' | 'catch'
  entity_id: string
  kind: string
  storage_path: string | null
  mime_type: string | null
  byte_size: number | null
  content_hash: string | null
  client_updated_at: number
}

/** 墓碑只需要更新这三个字段，不必重新拼一整行 */
export function tombstonePatch(
  meta: Pick<RecordSyncMeta, 'deletedAt' | 'clientUpdatedAt'>,
  deviceId: string,
): { deleted_at: string; client_updated_at: number; device_id?: string } {
  return {
    deleted_at: new Date(meta.deletedAt ?? meta.clientUpdatedAt).toISOString(),
    client_updated_at: meta.clientUpdatedAt,
    device_id: deviceId,
  }
}

export const SYNC_ENTITY_TABLE: Record<SyncEntity, string | null> = {
  gear: 'user_gears',
  spot: 'user_spots',
  trip: 'user_trips',
  catch: 'user_catches',
  pref: 'user_preferences',
  gearImage: 'user_images',
  catchImage: 'user_images',
}
