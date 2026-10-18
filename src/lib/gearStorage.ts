import { MOCK_GEAR } from '../data/mockGear'
import {
  CATEGORY_ORDER,
  type GearCategory,
  type GearItem,
  type GearSpec,
  type SpecKey,
} from '../types/gear'
import {
  activeScope,
  isAccountScope,
  isGuestScope,
  keyForScope,
  LEGACY_SCOPE_NAME,
} from './sync/scope'
import { markDeleted, markDirty } from './sync/meta'
import { emitLocalChange, emitRemoteApplied } from './sync/events'

/** localStorage 键名，带版本号方便以后升级数据结构 */
export const STORAGE_KEY = 'luremate:gear:v1'

/**
 * 会被保留的规格字段。读取旧数据时，只有出现在这里的字段才会留下来，
 * 所以新增分类（如周边装备的 accessoryType）必须同步加进来，否则保存后会被丢掉。
 */
const SPEC_KEYS: SpecKey[] = [
  'length',
  'action',
  'model',
  'ratio',
  'lureType',
  'weight',
  'accessoryType',
]

function isCategory(value: unknown): value is GearCategory {
  return CATEGORY_ORDER.includes(value as GearCategory)
}

function normalizeSpec(value: unknown): GearSpec {
  if (typeof value !== 'object' || value === null) return {}
  const source = value as Record<string, unknown>
  const spec: GearSpec = {}
  for (const key of SPEC_KEYS) {
    const raw = source[key]
    if (typeof raw === 'string' && raw.trim()) spec[key] = raw
  }
  return spec
}

/** 把存储中的未知数据整理成合法的装备对象，无法修复时返回 null */
function normalizeItem(value: unknown): GearItem | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name || !isCategory(raw.category)) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `gear-${Math.random().toString(36).slice(2, 10)}`,
    name,
    category: raw.category,
    brand: typeof raw.brand === 'string' ? raw.brand : '',
    spec: normalizeSpec(raw.spec),
    note: typeof raw.note === 'string' ? raw.note : '',
    purchasedAt: typeof raw.purchasedAt === 'string' ? raw.purchasedAt : '',
    favorite: raw.favorite === true,
    // V0.2/V0.3 的旧数据没有这个字段，读到时是 undefined，不影响其它内容
    catalogId: typeof raw.catalogId === 'string' ? raw.catalogId : undefined,
    // V0.4 之前的旧数据同样没有这个字段，一律按「关闭」处理，不影响其它内容
    showImageOnHome: raw.showImageOnHome === true,
  }
}

function storageKeyFor(targetScope: string): string {
  return keyForScope(STORAGE_KEY, targetScope)
}

function readRawText(targetScope: string): string | null {
  try {
    return localStorage.getItem(storageKeyFor(targetScope))
  } catch {
    return null
  }
}

/** 只读真实存储，不回退到演示数据；同步和认领都用它，避免把演示装备当成用户数据 */
export function loadGearRaw(targetScope = activeScope()): GearItem[] {
  const raw = readRawText(targetScope)
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeItem)
      .filter((item): item is GearItem => item !== null)
  } catch {
    return []
  }
}

export function writeGearRaw(
  items: GearItem[],
  targetScope = activeScope(),
): boolean {
  try {
    localStorage.setItem(storageKeyFor(targetScope), JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

/** 认领本机旧数据时，读取旧键名下的装备（没有存储记录就是空数组） */
export function loadLegacyGear(): GearItem[] {
  return loadGearRaw(LEGACY_SCOPE_NAME)
}

/**
 * 读取装备列表。
 * 只有在「还没有归属账号、本地也完全没有存储记录」时才返回演示数据；
 * 账号范围内没有数据就是空，等云端拉取，绝不把演示装备当成用户的云数据。
 */
export function loadGear(): GearItem[] {
  if (isGuestScope()) return []

  const raw = readRawText(activeScope())
  if (isAccountScope()) return loadGearRaw(activeScope())

  if (raw === null) return MOCK_GEAR

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return MOCK_GEAR
    return parsed
      .map(normalizeItem)
      .filter((item): item is GearItem => item !== null)
  } catch {
    return MOCK_GEAR
  }
}

/**
 * 写入装备列表并记录同步状态。
 *
 * 逐个和上次存储的内容比较：新增/修改标成待上传，删除留下墓碑。
 * 写入失败不阻塞界面，返回 false 让调用方决定是否提示。
 */
export function saveGear(items: GearItem[]): boolean {
  const previous = loadGearRaw(activeScope())
  const ok = writeGearRaw(items)

  // 只有本机写入成功后才记录待同步状态；写失败时不能把云端数据误标成删除
  if (ok) {
    const previousById = new Map(previous.map((item) => [item.id, item]))
    const now = Date.now()

    for (const item of items) {
      const before = previousById.get(item.id)
      if (!before || JSON.stringify(before) !== JSON.stringify(item)) {
        markDirty('gear', item.id, now)
      }
      previousById.delete(item.id)
    }
    for (const removedId of previousById.keys()) {
      markDeleted('gear', removedId, now)
    }
    emitLocalChange('gear')
  }
  return ok
}

/** 云端数据合并完成后整体写回，不产生新的待上传记录 */
export function applyGearFromRemote(items: GearItem[]): boolean {
  const ok = writeGearRaw(items)
  if (ok) emitRemoteApplied('gear')
  return ok
}
