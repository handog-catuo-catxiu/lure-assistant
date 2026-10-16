/**
 * 把 AI 选出来的 id 还原成界面上的推荐卡片。
 *
 * 名字、难度、时间段这些**显示内容一律取自本地数据**，AI 只提供
 * 「选哪几条 + 一句理由 + 一句建议」。这样即使模型哪天换了措辞，
 * 卡片上的鱼名和百科里也不会对不上。
 */
import { speciesDisplayName } from '../encyclopedia'
import type { SpeciesAdvice, SpeciesCandidate, Screening } from '../recommend'
import { candidateTimeWindow } from '../recommend'
import type { WeatherNow } from '../../weather/types'
import type { AiAdviceItem, AiRating } from './types'

const RATING_BY_AI: Record<AiRating, SpeciesAdvice['rating']> = {
  high: '值得尝试',
  mid: '可以关注',
  low: '条件一般',
}

/**
 * @param items 已通过 parse.ts 校验的条目（id 一定在候选里，这里再做一次兜底）
 * @param screening 本地规则筛出来的候选，卡片的时间段、名字都从这里取
 */
export function adviceFromAi(
  items: AiAdviceItem[],
  screening: Screening,
  weather: WeatherNow | null,
): SpeciesAdvice[] {
  const byId = new Map<string, SpeciesCandidate>(
    screening.candidates.map((candidate) => [candidate.profile.id, candidate]),
  )

  const advice: SpeciesAdvice[] = []
  for (const item of items) {
    const candidate = byId.get(item.speciesId)
    if (!candidate) continue

    // AI 的理由 + 一条本地规则的数值依据：既说清了「为什么是现在」，
    // 也让用户看得到这句话是拿气温、季节、水型算出来的
    const reasons = [item.reason]
    const ruleReason = candidate.reasons[0]
    if (ruleReason && !item.reason.includes(ruleReason)) reasons.push(ruleReason)

    advice.push({
      id: candidate.profile.id,
      name: speciesDisplayName(candidate.profile.id, candidate.profile.name),
      rating: RATING_BY_AI[item.rating],
      reasons,
      timeWindow: candidateTimeWindow(candidate, weather),
      tip: item.tip,
    })
  }

  return advice
}

/**
 * 卡片底部那行「这次是谁给的结论」。
 * 只写结论来源和一句 AI 的区域概述，不写模型内部细节，也不写任何配置信息。
 */
export function aiBasisLine(note: string | null): string[] {
  const lines: string[] = []
  if (note) lines.push(`区域鱼情：${note}`)
  return lines
}
