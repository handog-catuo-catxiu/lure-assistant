import { MOCK_GEAR } from '../data/mockGear'
import {
  CATEGORY_ORDER,
  type GearCategory,
  type GearItem,
  type GearSpec,
  type SpecKey,
} from '../types/gear'

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

/**
 * 读取装备列表。
 * 只有在本地完全没有存储记录时（首次使用）才返回模拟数据；
 * 用户删除至空列表时存储中是 []，仍以用户数据为准。
 */
export function loadGear(): GearItem[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // 隐私模式等无法访问 localStorage 的场景，退化为只读的模拟数据
    return MOCK_GEAR
  }

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

/** 写入装备列表，写入失败不阻塞界面 */
export function saveGear(items: GearItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 忽略写入失败（存储已满、隐私模式等）
  }
}
