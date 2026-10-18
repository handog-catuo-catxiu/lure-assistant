/**
 * 同步元数据。
 *
 * 用户数据本身仍按原来的结构存放（装备 / 标点 / 出勤 / 渔获的 localStorage，
 * 照片的 IndexedDB），这里只额外记录「哪一条改过、删过、上次同步到哪儿」。
 * 这样不需要给 GearItem、Spot 等类型硬塞同步字段，也不会改变已有数据格式。
 */
import { activeScope, scopedKey } from './scope'
import { emitLocalChange } from './events'
import type { LocalChangeKind } from './events'

export type SyncEntity =
  | 'gear'
  | 'spot'
  | 'trip'
  | 'catch'
  | 'pref'
  | 'gearImage'
  | 'catchImage'

export interface RecordSyncMeta {
  /** 本地最后一次修改时间（毫秒），用于冲突时的最后写入优先 */
  clientUpdatedAt: number
  /** 本地删除时间；有值表示这是一条待上传的墓碑 */
  deletedAt: number | null
  /** 还没成功推到云端 */
  dirty: boolean
  /** 服务端最后一次确认的时间（ISO 字符串） */
  serverUpdatedAt: string | null
}

export interface SyncMeta {
  version: 1
  records: Record<string, RecordSyncMeta>
  /** 每张表增量拉取的游标（服务端 updated_at，ISO 字符串） */
  cursors: Record<string, string>
  /** 每场出勤已经上传过的轨迹点数量，用来判断有没有新增点 */
  trackSynced: Record<string, number>
  lastSyncedAt: number | null
}

const META_KEY = 'luremate:sync-meta:v1'

let cache: SyncMeta | null = null
let cacheScope = ''
let cacheRaw: string | null = null

function emptyMeta(): SyncMeta {
  return {
    version: 1,
    records: {},
    cursors: {},
    trackSynced: {},
    lastSyncedAt: null,
  }
}

function normalizeRecord(value: unknown): RecordSyncMeta | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const clientUpdatedAt =
    typeof raw.clientUpdatedAt === 'number' && Number.isFinite(raw.clientUpdatedAt)
      ? raw.clientUpdatedAt
      : 0
  return {
    clientUpdatedAt,
    deletedAt:
      typeof raw.deletedAt === 'number' && Number.isFinite(raw.deletedAt)
        ? raw.deletedAt
        : null,
    dirty: raw.dirty === true,
    serverUpdatedAt:
      typeof raw.serverUpdatedAt === 'string' ? raw.serverUpdatedAt : null,
  }
}

function normalizeMeta(value: unknown): SyncMeta {
  const meta = emptyMeta()
  if (typeof value !== 'object' || value === null) return meta
  const raw = value as Record<string, unknown>

  if (typeof raw.records === 'object' && raw.records !== null) {
    for (const [key, record] of Object.entries(raw.records)) {
      const normalized = normalizeRecord(record)
      if (normalized) meta.records[key] = normalized
    }
  }
  if (typeof raw.cursors === 'object' && raw.cursors !== null) {
    for (const [key, value] of Object.entries(raw.cursors)) {
      if (typeof value === 'string') meta.cursors[key] = value
    }
  }
  if (typeof raw.trackSynced === 'object' && raw.trackSynced !== null) {
    for (const [key, value] of Object.entries(raw.trackSynced)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        meta.trackSynced[key] = value
      }
    }
  }
  if (typeof raw.lastSyncedAt === 'number' && Number.isFinite(raw.lastSyncedAt)) {
    meta.lastSyncedAt = raw.lastSyncedAt
  }
  return meta
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(scopedKey(META_KEY))
  } catch {
    return null
  }
}

/** 读取当前范围的同步元数据；localStorage 不可用时退回内存 */
export function loadMeta(): SyncMeta {
  const scope = activeScope()
  const raw = readRaw()
  if (scope === cacheScope && cache && raw === cacheRaw) return cache

  if (raw === null) {
    cache = emptyMeta()
  } else {
    try {
      cache = normalizeMeta(JSON.parse(raw))
    } catch {
      cache = emptyMeta()
    }
  }
  cacheScope = scope
  cacheRaw = raw
  return cache
}

function saveMeta(meta: SyncMeta): void {
  cache = meta
  cacheScope = activeScope()
  try {
    const raw = JSON.stringify(meta)
    localStorage.setItem(scopedKey(META_KEY), raw)
    cacheRaw = raw
  } catch {
    // 写不下也不影响本地数据；本次会话内仍靠内存中的状态继续尝试
    cacheRaw = null
  }
}

function recordKey(kind: SyncEntity, id: string): string {
  return `${kind}:${id}`
}

function changeKindOf(kind: SyncEntity): LocalChangeKind {
  if (kind === 'gearImage' || kind === 'catchImage') return 'image'
  if (kind === 'pref') return 'pref'
  return kind
}

export function getRecordMeta(
  kind: SyncEntity,
  id: string,
): RecordSyncMeta | null {
  return loadMeta().records[recordKey(kind, id)] ?? null
}

/** 本地新增或修改 */
export function markDirty(kind: SyncEntity, id: string, at = Date.now()): void {
  const meta = loadMeta()
  const key = recordKey(kind, id)
  const previous = meta.records[key]
  meta.records[key] = {
    clientUpdatedAt: at,
    deletedAt: null,
    dirty: true,
    serverUpdatedAt: previous?.serverUpdatedAt ?? null,
  }
  saveMeta(meta)
  emitLocalChange('meta')
  emitLocalChange(changeKindOf(kind))
}

/** 本地删除：保留一条墓碑，等云端也删掉后再清掉 */
export function markDeleted(kind: SyncEntity, id: string, at = Date.now()): void {
  const meta = loadMeta()
  const key = recordKey(kind, id)
  const previous = meta.records[key]
  meta.records[key] = {
    clientUpdatedAt: at,
    deletedAt: at,
    dirty: true,
    serverUpdatedAt: previous?.serverUpdatedAt ?? null,
  }
  saveMeta(meta)
  emitLocalChange('meta')
  emitLocalChange(changeKindOf(kind))
}

/** 推送成功，记下服务端时间 */
export function markClean(
  kind: SyncEntity,
  id: string,
  serverUpdatedAt: string | null,
): void {
  const meta = loadMeta()
  const key = recordKey(kind, id)
  const previous = meta.records[key]
  if (!previous) return
  meta.records[key] = {
    clientUpdatedAt: previous.clientUpdatedAt,
    deletedAt: null,
    dirty: false,
    serverUpdatedAt,
  }
  saveMeta(meta)
}

/** 墓碑已经推到云端后，本地不再需要保留这条元数据 */
export function forgetRecord(kind: SyncEntity, id: string): void {
  const meta = loadMeta()
  const key = recordKey(kind, id)
  if (!(key in meta.records)) return
  delete meta.records[key]
  saveMeta(meta)
}

/** 拉取云端记录后登记状态（不触发本地变更通知） */
export function applyRemoteMeta(
  kind: SyncEntity,
  id: string,
  clientUpdatedAt: number,
  serverUpdatedAt: string | null,
): void {
  const meta = loadMeta()
  meta.records[recordKey(kind, id)] = {
    clientUpdatedAt,
    deletedAt: null,
    dirty: false,
    serverUpdatedAt,
  }
  saveMeta(meta)
}

export interface PendingRecord {
  id: string
  meta: RecordSyncMeta
}

export function pendingRecords(kind: SyncEntity): PendingRecord[] {
  const meta = loadMeta()
  const prefix = `${kind}:`
  return Object.entries(meta.records)
    .filter(([key, record]) => key.startsWith(prefix) && record.dirty)
    .map(([key, record]) => ({ id: key.slice(prefix.length), meta: record }))
}

export function pendingCount(): number {
  return Object.values(loadMeta().records).filter((record) => record.dirty).length
}

/** 首次认领/首次导入时，把一批记录全部标成待上传 */
export function markAllDirty(
  kind: SyncEntity,
  ids: string[],
  at = Date.now(),
): void {
  if (ids.length === 0) return
  const meta = loadMeta()
  for (const id of ids) {
    const key = recordKey(kind, id)
    const previous = meta.records[key]
    meta.records[key] = {
      clientUpdatedAt: at,
      deletedAt: null,
      dirty: true,
      serverUpdatedAt: previous?.serverUpdatedAt ?? null,
    }
  }
  saveMeta(meta)
  emitLocalChange('meta')
}

/* ------------------------------ 增量游标 ------------------------------ */

export function getCursor(table: string): string | null {
  return loadMeta().cursors[table] ?? null
}

export function setCursor(table: string, value: string): void {
  const meta = loadMeta()
  meta.cursors[table] = value
  saveMeta(meta)
}

/* --------------------------- 轨迹上传进度 --------------------------- */

export function getTrackSynced(sessionId: string): number {
  return loadMeta().trackSynced[sessionId] ?? 0
}

export function setTrackSynced(sessionId: string, count: number): void {
  const meta = loadMeta()
  meta.trackSynced[sessionId] = count
  saveMeta(meta)
}

/* ------------------------------ 同步时间 ------------------------------ */

export function getLastSyncedAt(): number | null {
  return loadMeta().lastSyncedAt
}

export function setLastSyncedAt(at = Date.now()): void {
  const meta = loadMeta()
  meta.lastSyncedAt = at
  saveMeta(meta)
  emitLocalChange('meta')
}

/** 测试用：清掉内存缓存，下次读取重新从 localStorage 解析 */
export function resetMetaCache(): void {
  cache = null
  cacheScope = ''
  cacheRaw = null
}
