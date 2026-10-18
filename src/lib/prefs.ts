/**
 * 会跟随账号同步的轻量偏好。
 *
 * 目前实际存在、并且跨设备有意义的是首页的两个选择：
 * - 参考钓点（选一个已有标点当天气/鱼情的参考位置）
 * - 水型（自动判断 / 静水 / 流水 / 海水）
 *
 * 天气缓存、AI 结果、当前定位这些是临时的，不放进这里。
 */
import type { WaterType } from './fish/species'
import { activeScope, keyForScope, LEGACY_SCOPE_NAME } from './sync/scope'
import { getRecordMeta, markDirty } from './sync/meta'
import { emitRemoteApplied } from './sync/events'

export const PREFS_KEY = 'luremate:prefs:v1'

/** 旧版首页直接写在这两个键里的偏好，首次读取时兼容 */
const LEGACY_REF_SPOT_KEY = 'luremate:fish-ref-spot:v1'
const LEGACY_WATER_KEY = 'luremate:fish-water:v1'

export type PrefKey = 'home.refSpot' | 'home.water'

export interface LocalPrefs {
  homeRefSpot: string | null
  homeWater: WaterType
}

export interface PrefRow {
  key: string
  value: unknown
  deleted: boolean
  clientUpdatedAt: number
  serverUpdatedAt: string | null
}

const DEFAULT_PREFS: LocalPrefs = {
  homeRefSpot: null,
  homeWater: 'unknown',
}

function asWater(value: unknown): WaterType {
  return value === 'still' || value === 'flowing' || value === 'sea'
    ? value
    : 'unknown'
}

function asRefSpot(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readJson(targetScope: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(keyForScope(PREFS_KEY, targetScope))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function normalizePrefs(value: Record<string, unknown> | null): LocalPrefs {
  if (!value) return { ...DEFAULT_PREFS }
  return {
    homeRefSpot: asRefSpot(value['home.refSpot']),
    homeWater: asWater(value['home.water']),
  }
}

/** 读取当前范围的偏好；旧版没有 prefs 键时兼容旧的两个单独键 */
export function loadPrefs(targetScope = activeScope()): LocalPrefs {
  const stored = readJson(targetScope)
  if (stored) return normalizePrefs(stored)

  if (targetScope === LEGACY_SCOPE_NAME) {
    try {
      return {
        homeRefSpot: asRefSpot(localStorage.getItem(LEGACY_REF_SPOT_KEY)),
        homeWater: asWater(localStorage.getItem(LEGACY_WATER_KEY)),
      }
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }
  return { ...DEFAULT_PREFS }
}

/** 认领本机旧数据时使用 */
export function loadLegacyPrefs(): LocalPrefs {
  return loadPrefs(LEGACY_SCOPE_NAME)
}

function writePrefs(prefs: LocalPrefs, targetScope: string): boolean {
  try {
    localStorage.setItem(
      keyForScope(PREFS_KEY, targetScope),
      JSON.stringify({
        'home.refSpot': prefs.homeRefSpot,
        'home.water': prefs.homeWater,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function savePref<K extends keyof LocalPrefs>(
  key: K,
  value: LocalPrefs[K],
): void {
  const next = { ...loadPrefs(), [key]: value }
  if (!writePrefs(next, activeScope())) return

  const prefKey: PrefKey = key === 'homeRefSpot' ? 'home.refSpot' : 'home.water'
  markDirty('pref', prefKey)
}

/** 用于首次认领：把旧偏好写进账号范围并标成待上传 */
export function importLegacyPrefs(): number {
  const legacy = loadLegacyPrefs()
  const current = loadPrefs()
  const merged: LocalPrefs = {
    homeRefSpot: current.homeRefSpot ?? legacy.homeRefSpot,
    homeWater: current.homeWater !== 'unknown' ? current.homeWater : legacy.homeWater,
  }
  if (!writePrefs(merged, activeScope())) return 0

  let count = 0
  if (merged.homeRefSpot !== null) {
    markDirty('pref', 'home.refSpot')
    count += 1
  }
  if (merged.homeWater !== 'unknown') {
    markDirty('pref', 'home.water')
    count += 1
  }
  return count
}

/** 待上传的偏好（只返回真正改过的项） */
export function pendingPrefRows(): Array<{ key: PrefKey; value: unknown; clientUpdatedAt: number; deleted: boolean }> {
  const prefs = loadPrefs()
  const rows: Array<{ key: PrefKey; value: unknown; clientUpdatedAt: number; deleted: boolean }> = []
  const entries: Array<[PrefKey, unknown, boolean]> = [
    ['home.refSpot', prefs.homeRefSpot, prefs.homeRefSpot === null],
    ['home.water', prefs.homeWater, prefs.homeWater === 'unknown'],
  ]
  for (const [key, value, deleted] of entries) {
    const meta = getRecordMeta('pref', key)
    if (!meta?.dirty) continue
    rows.push({
      key,
      value,
      deleted,
      clientUpdatedAt: meta.clientUpdatedAt,
    })
  }
  return rows
}

/** 云端偏好合并到本地；本地有未上传修改的项以本地为准 */
export function applyPrefsFromRemote(rows: PrefRow[]): boolean {
  if (rows.length === 0) return false

  const next = { ...loadPrefs() }
  let changed = false

  for (const row of rows) {
    if (getRecordMeta('pref', row.key)?.dirty) continue
    if (row.key === 'home.refSpot') {
      const value = row.deleted ? null : asRefSpot(row.value)
      if (next.homeRefSpot !== value) {
        next.homeRefSpot = value
        changed = true
      }
    } else if (row.key === 'home.water') {
      const value = row.deleted ? 'unknown' : asWater(row.value)
      if (next.homeWater !== value) {
        next.homeWater = value
        changed = true
      }
    }
  }

  if (changed && writePrefs(next, activeScope())) emitRemoteApplied('pref')
  return changed
}
