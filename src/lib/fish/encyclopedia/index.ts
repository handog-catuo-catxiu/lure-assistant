/**
 * 鱼类百科资料库的入口。
 *
 * 这里只做两件事：
 * 1. 把三份按水域分组的资料合成一张按 id 索引的表；
 * 2. 提供「推荐规则的鱼种 id → 百科条目」的查找，让推荐卡片能跳到百科。
 *
 * 资料写死在仓库里（见 types.ts 的说明）：打开百科读本地数据，
 * 不联网、不调用 AI 重新生成，同一个鱼种每次看到的解释都一样。
 */
import type { SpeciesEntry } from './types'
import { STILLWATER_SPECIES } from './stillwater'
import { FLOWING_SPECIES } from './flowing'
import { SALTWATER_SPECIES } from './saltwater'

/** 全部百科条目。顺序只影响「全部鱼种」列表的展示，不影响检索。 */
export const ALL_SPECIES: SpeciesEntry[] = [...STILLWATER_SPECIES, ...FLOWING_SPECIES, ...SALTWATER_SPECIES]

const BY_ID = new Map<string, SpeciesEntry>(ALL_SPECIES.map((entry) => [entry.id, entry]))

/** 按 id 取百科条目；没有条目就返回 null（页面据此提示「暂无百科资料」）。 */
export function findSpecies(id: string | null | undefined): SpeciesEntry | null {
  if (!id) return null
  return BY_ID.get(id) ?? null
}

/** 推荐卡片上显示的名字：百科里有就用百科的正式名，否则退回规则表里的名字。 */
export function speciesDisplayName(id: string, fallback: string): string {
  return findSpecies(id)?.name ?? fallback
}

/**
 * 水域类型是否相容：推荐规则表里的 water 写得比较保守（例如大口黑鲈只写静水），
 * 百科写的更贴近实际栖息地。这里只要求两者**有交集**，不要求完全一致 ——
 * 目的是挡住「把海水鱼种推给内陆用户」这类明显矛盾的组合，而不是挑剔措辞。
 */
export function waterOverlaps(entry: SpeciesEntry, waters: string[]): boolean {
  return entry.water.some((w) => waters.includes(w))
}

/** 百科覆盖情况，供开发时自检：返回有推荐规则但没有百科条目的 id。 */
export function missingEntries(ids: string[]): string[] {
  return ids.filter((id) => !BY_ID.has(id))
}
