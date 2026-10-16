/**
 * 渔获档案的排序、筛选与统计 —— 全是纯函数，和界面无关，方便单独验证。
 *
 * 两条数据纪律：
 * 1. **筛选条件只能来自真实数据**：鱼种、钓点、出勤三个可选项都是从渔获记录里
 *    现算出来的（`buildFacets`），没有写死任何一个鱼种名。
 * 2. **没有的数值排在最后**：长度或重量为空的渔获，在按长度 / 重量排序时垫底，
 *    不会被当成 0 排到最前面 —— 那等于凭空造了一个「0 厘米」的鱼。
 */
import type { CatchRecord } from '../types/trip'

export type CatchSortKey = 'newest' | 'oldest' | 'length' | 'weight'
export type CatchTimeRange = 'all' | '7d' | '30d' | 'year'

export interface CatchQuery {
  keyword: string
  /** 鱼种名；null = 全部 */
  species: string | null
  spotId: string | null
  sessionId: string | null
  range: CatchTimeRange
}

export const EMPTY_QUERY: CatchQuery = {
  keyword: '',
  species: null,
  spotId: null,
  sessionId: null,
  range: 'all',
}

export const SORT_LABELS: Record<CatchSortKey, string> = {
  newest: '最新优先',
  oldest: '最早优先',
  length: '长度最大',
  weight: '重量最大',
}

export const RANGE_LABELS: Record<CatchTimeRange, string> = {
  all: '全部时间',
  '7d': '近 7 天',
  '30d': '近 30 天',
  year: '今年',
}

const DAY_MS = 24 * 60 * 60_000

/* ------------------------------ 统计 ------------------------------ */

export interface CatchStats {
  count: number
  speciesCount: number
  /** 最大长度（cm）；一条都没有填长度的渔获时为 null */
  maxLengthCm: number | null
  maxWeightG: number | null
}

/** 顶部四个统计永远基于**全部**渔获，不受筛选影响 */
export function summarizeCatches(catches: CatchRecord[]): CatchStats {
  const species = new Set<string>()
  let maxLengthCm: number | null = null
  let maxWeightG: number | null = null

  for (const record of catches) {
    const name = record.species.trim()
    if (name) species.add(name)
    if (record.lengthCm !== null && (maxLengthCm === null || record.lengthCm > maxLengthCm)) {
      maxLengthCm = record.lengthCm
    }
    if (record.weightG !== null && (maxWeightG === null || record.weightG > maxWeightG)) {
      maxWeightG = record.weightG
    }
  }

  return { count: catches.length, speciesCount: species.size, maxLengthCm, maxWeightG }
}

/* ------------------------------ 筛选项 ------------------------------ */

export interface FacetOption {
  value: string
  label: string
  count: number
}

export interface CatchFacets {
  species: FacetOption[]
  spots: FacetOption[]
  sessions: FacetOption[]
}

interface FacetSources {
  /** 标点 id → 名字；找不到返回 null（标点被删了） */
  spotNameOf: (spotId: string) => string | null
  /** 出勤 id → 一眼能认出的标签；找不到返回 null */
  sessionLabelOf: (sessionId: string) => string | null
}

function tally(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function toOptions(counts: Map<string, number>, labelOf: (value: string) => string): FacetOption[] {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'))
}

/** 从真实渔获里算出可选的鱼种 / 钓点 / 出勤 */
export function buildFacets(catches: CatchRecord[], sources: FacetSources): CatchFacets {
  const speciesCounts = new Map<string, number>()
  const spotCounts = new Map<string, number>()
  const sessionCounts = new Map<string, number>()

  for (const record of catches) {
    const name = record.species.trim()
    if (name) tally(speciesCounts, name)
    if (record.spotId) tally(spotCounts, record.spotId)
    if (record.sessionId) tally(sessionCounts, record.sessionId)
  }

  return {
    species: toOptions(speciesCounts, (value) => value),
    spots: toOptions(spotCounts, (value) => sources.spotNameOf(value) ?? '标点已删除'),
    sessions: toOptions(sessionCounts, (value) => sources.sessionLabelOf(value) ?? '出勤记录已删除'),
  }
}

/* ------------------------------ 筛选 ------------------------------ */

export function isQueryActive(query: CatchQuery): boolean {
  return (
    query.keyword.trim() !== '' ||
    query.species !== null ||
    query.spotId !== null ||
    query.sessionId !== null ||
    query.range !== 'all'
  )
}

function rangeStart(range: CatchTimeRange, now: number): number | null {
  if (range === 'all') return null
  if (range === '7d') return now - 7 * DAY_MS
  if (range === '30d') return now - 30 * DAY_MS
  const date = new Date(now)
  return new Date(date.getFullYear(), 0, 1).getTime()
}

interface FilterSources extends FacetSources {
  /** 当前时间，由调用方用 useNow 提供（渲染里不直接读时钟） */
  now: number
}

/**
 * 关键字匹配鱼种、钓点和备注 —— 用户记得住的大概就是这三样。
 * 条件之间是「且」，空条件不参与判断。
 */
export function filterCatches(
  catches: CatchRecord[],
  query: CatchQuery,
  sources: FilterSources,
): CatchRecord[] {
  const keyword = query.keyword.trim().toLowerCase()
  const start = rangeStart(query.range, sources.now)

  return catches.filter((record) => {
    if (query.species !== null && record.species.trim() !== query.species) return false
    if (query.spotId !== null && record.spotId !== query.spotId) return false
    if (query.sessionId !== null && record.sessionId !== query.sessionId) return false
    if (start !== null && record.caughtAt < start) return false

    if (keyword) {
      const haystack = [
        record.species,
        record.note,
        record.spotId ? (sources.spotNameOf(record.spotId) ?? '') : '',
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(keyword)) return false
    }

    return true
  })
}

/* ------------------------------ 排序 ------------------------------ */

/** 数值排序时把 null 放到最后：没有数据就是没有，不当作 0 */
function compareNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

export function sortCatches(catches: CatchRecord[], key: CatchSortKey): CatchRecord[] {
  const list = [...catches]
  switch (key) {
    case 'oldest':
      return list.sort((a, b) => a.caughtAt - b.caughtAt)
    case 'length':
      // 长度相同的按时间倒序，顺序稳定、看着不凌乱
      return list.sort(
        (a, b) => compareNumbers(a.lengthCm, b.lengthCm) || b.caughtAt - a.caughtAt,
      )
    case 'weight':
      return list.sort(
        (a, b) => compareNumbers(a.weightG, b.weightG) || b.caughtAt - a.caughtAt,
      )
    default:
      return list.sort((a, b) => b.caughtAt - a.caughtAt)
  }
}
