/**
 * 交给 AI 的「事实底稿」。
 *
 * 这是整个 AI 推荐里最关键的一环：**先把当地可能存在的鱼筛出来，再让 AI 排序**。
 * 底稿里的每一条都来自两个本地数据源：
 *   - 分布 / 季节 / 水域 / 气温筛选：lib/fish/recommend.ts 的 screenSpecies()
 *   - 形态、习性、分布、体型、拟饵：lib/fish/encyclopedia 的百科条目
 *
 * 没有百科条目的鱼种不会进底稿 —— 说不清它在中国大陆的分布，就不该推荐它。
 * 候选少于 MIN_AI_CANDIDATES 条时直接返回 null：与其让 AI 硬凑，不如老实走本地规则。
 */
import { findSpecies } from '../encyclopedia'
import { screenSpecies, type AdviceInput, type SpeciesCandidate } from '../recommend'
import { SEASON_LABELS, WATER_LABELS, type Season, type WaterType } from '../species'

/** 底稿里最多放几条候选（给 AI 留出挑选空间，同时控制 token） */
export const MAX_GROUNDING_CANDIDATES = 8
/** 候选少于这个数就不值得惊动 AI，直接走本地规则 */
export const MIN_AI_CANDIDATES = 3

/** 用户在首页选的位置：具体钓点，或者只有当前位置（区域鱼情参考） */
export interface GroundingPlace {
  /** 展示名，例如「千岛湖东南角」或「杭州 西湖区」 */
  label: string
  /** spot = 选了具体钓点；region = 只有大致位置 */
  scope: 'spot' | 'region'
  latitude: number
  longitude: number
}

export interface GroundingSpecies {
  id: string
  name: string
  scientificName: string | null
  aliases: string[]
  difficulty: string | null
  /** 百科里写的水域类型 */
  water: string[]
  /** 在中国大陆的分布描述 */
  distribution: string
  /** 生活习性（截断后的短句） */
  habitat: string
  /** 食性 */
  diet: string
  /** 当前季节的活动特点 */
  currentSeason: string
  /** 常见体长 / 体重 */
  sizeText: string
  /** 推荐拟饵 */
  lures: string[]
  /** 推荐钓位 */
  spots: string
  /** 本地规则给出的真实数值依据，AI 可以引用 */
  ruleReasons: string[]
  ruleScore: number
}

export interface GroundingWeather {
  condition: string
  temperatureC: number
  apparentC: number | null
  humidityPercent: number | null
  windDirection: string | null
  windPower: number | null
  precipitationMm: number | null
}

export interface Grounding {
  place: GroundingPlace
  month: number
  season: Season
  seasonLabel: string
  /** 日期文字，例「2026-10-17」，由调用方传进来（渲染里不读时钟） */
  todayLabel: string
  weather: GroundingWeather | null
  water: WaterType
  waterLabel: string
  /** 本地规则算出来的判断依据，原样带进提示词 */
  lines: string[]
  candidates: GroundingSpecies[]
}

/** 把长句截断，只保留最有信息量的前半段 */
function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

function sizeTextOf(candidate: SpeciesCandidate): string | null {
  const entry = findSpecies(candidate.profile.id)
  if (!entry) return null
  const { lengthCm, weightKg } = entry.size
  return `常见 ${lengthCm[0]}–${lengthCm[1]} cm / ${weightKg[0]}–${weightKg[1]} kg`
}

function toGroundingSpecies(candidate: SpeciesCandidate, season: Season): GroundingSpecies | null {
  const entry = findSpecies(candidate.profile.id)
  // 没有百科条目 = 说不清当地分布 = 不进底稿
  if (!entry) return null

  return {
    id: entry.id,
    name: entry.name,
    scientificName: entry.scientificName,
    aliases: entry.aliases,
    difficulty: entry.difficulty,
    water: entry.water,
    distribution: entry.distribution,
    habitat: clip(entry.habits, 110),
    diet: clip(entry.diet, 60),
    currentSeason: entry.seasons[season],
    sizeText: sizeTextOf(candidate) ?? '',
    lures: entry.luring.lures,
    spots: entry.luring.spots,
    ruleReasons: candidate.reasons,
    ruleScore: candidate.score,
  }
}

/**
 * 生成底稿。返回 null 表示「这次不该调用 AI」：
 * 没有位置、规则筛选不出候选、候选太少、或者候选里没有一条有百科依据。
 */
export function buildGrounding(params: {
  input: AdviceInput
  place: GroundingPlace | null
  todayLabel: string
}): Grounding | null {
  const { input, place, todayLabel } = params
  if (!place) return null

  const screen = screenSpecies(input)
  if (screen.status !== 'ok') return null

  const { candidates, water, season, month, lines } = screen.screening
  const grounded = candidates
    .slice(0, MAX_GROUNDING_CANDIDATES)
    .map((candidate) => toGroundingSpecies(candidate, season))
    .filter((item): item is GroundingSpecies => item !== null)

  if (grounded.length < MIN_AI_CANDIDATES) return null

  const weather: GroundingWeather | null = input.weather
    ? {
        condition: input.weather.condition,
        temperatureC: input.weather.temperatureC,
        apparentC: input.weather.apparentC,
        humidityPercent: input.weather.humidityPercent,
        windDirection: input.weather.windDirection,
        windPower: input.weather.windPower,
        precipitationMm: input.weather.precipitationMm,
      }
    : null

  return {
    place,
    month,
    season,
    seasonLabel: SEASON_LABELS[season],
    todayLabel,
    weather,
    water,
    waterLabel: WATER_LABELS[water],
    lines,
    candidates: grounded,
  }
}

/** 候选 id 列表 —— 解析 AI 返回内容时用它做白名单 */
export function candidateIds(grounding: Grounding): string[] {
  return grounding.candidates.map((item) => item.id)
}
