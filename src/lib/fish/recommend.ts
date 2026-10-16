/**
 * 今日推荐鱼种：纯规则，不调用任何 AI，也没有任何联网推理。
 *
 * 输入是「真实拿得到的东西」：纬度、月份、能判断出来的水域类型、当前天气。
 * 输出是「带理由的排序结果」，理由全部由输入里的数值拼出来 ——
 * 温度、月份、天气现象、风力都是从真实数据里取的，说不出理由的鱼不会被推荐。
 *
 * 几条硬规矩：
 * 1. **先过滤，再打分**：纬度带、半球、季节、水域类型不满足的，直接不进候选，
 *    所以不会出现「所有地区都推翘嘴/鳜鱼/黑鱼」。
 * 2. **南北半球都要对**：季节按半球换算；分布纬度带用绝对值判断。
 * 3. **数据不够就说不够**：没有位置、或者当地纬度超出全部鱼种的分布范围，
 *    返回 insufficient，界面上如实显示「暂时无法准确推荐当地鱼种」。
 * 4. **不许出现保证性话术**：评级只有「值得尝试 / 可以关注 / 条件一般」三档。
 */
import { SPECIES, WATER_LABELS, type Hemisphere, type Season, type SpeciesProfile, type WaterType } from './species'
import type { WeatherKind, WeatherNow } from '../weather/types'

export type AdviceRating = '值得尝试' | '可以关注' | '条件一般'

export interface SpeciesAdvice {
  id: string
  name: string
  rating: AdviceRating
  /** 推荐理由，每条都能对应到输入里的一个真实数值 */
  reasons: string[]
  /** 关注的时间段 */
  timeWindow: string
  /** 简短建议 */
  tip: string
}

export interface AdviceInput {
  latitude: number | null
  longitude: number | null
  /** 当前月份 1–12 */
  month: number
  /** 逆地理编码拿到的地名，用来推断水域类型 */
  placeName?: string | null
  /** 用户手动指定的水域类型；null / undefined = 按地名自动判断 */
  waterOverride?: WaterType | null
  weather?: WeatherNow | null
}

export interface AdviceBasis {
  /** 判断依据，一行一条，直接显示在卡片底部 */
  lines: string[]
}

export type AdviceResult =
  | ({ status: 'ok'; advice: SpeciesAdvice[]; water: WaterType } & AdviceBasis)
  | ({ status: 'insufficient'; message: string; hint: string } & AdviceBasis)

export const INSUFFICIENT_MESSAGE = '暂时无法准确推荐当地鱼种'
export const INSUFFICIENT_HINT = '可以选择钓鱼地区或水域类型，帮助获得更合适的建议。'

/** 最多显示几个鱼种 */
export const MAX_ADVICE = 4
/** 气温和活跃区间相差超过这个度数就不考虑了 */
const TEMP_TOLERANCE = 12
/** 风力到这个级别，所有鱼种一起扣分（抛投和控饵都变难） */
const STRONG_WIND_POWER = 6

/* ------------------------------ 基础换算 ------------------------------ */

export function hemisphereOf(latitude: number): Hemisphere {
  return latitude >= 0 ? 'n' : 's'
}

/** 月份 → 季节。南半球整体错开半年 */
export function seasonOf(month: number, hemisphere: Hemisphere): Season {
  const north: Season[] = [
    'winter',
    'winter',
    'spring',
    'spring',
    'spring',
    'summer',
    'summer',
    'summer',
    'autumn',
    'autumn',
    'autumn',
    'winter',
  ]
  const season = north[((month - 1) % 12 + 12) % 12]
  if (hemisphere === 'n') return season
  const flip: Record<Season, Season> = {
    spring: 'autumn',
    summer: 'winter',
    autumn: 'spring',
    winter: 'summer',
  }
  return flip[season]
}

const SEA_HINTS = ['海', '港', '湾', '岛', '滩', '礁', '洋', '码头', '防波堤']
const STILL_HINTS = ['水库', '湖', '塘', '潭', '池', '坝', '库区']
const FLOWING_HINTS = ['河', '江', '溪', '川', '渠', '涧', '支流']

/**
 * 从地名里推断水域类型。判断不出来就返回 unknown ——
 * 这时候不猜，界面上会写「不确定」，并且允许用户自己选。
 */
export function inferWaterType(...names: (string | null | undefined)[]): WaterType {
  const text = names.filter((value): value is string => typeof value === 'string').join(' ')
  if (!text) return 'unknown'

  // 先看海：海边水库这种名字里「海」比「水库」更能代表实际作钓环境
  if (SEA_HINTS.some((hint) => text.includes(hint))) return 'sea'
  if (STILL_HINTS.some((hint) => text.includes(hint))) return 'still'
  if (FLOWING_HINTS.some((hint) => text.includes(hint))) return 'flowing'
  return 'unknown'
}

/* ------------------------------ 理由文案 ------------------------------ */

const WEATHER_REASONS: Record<WeatherKind, string> = {
  clear: '晴天光照强，它会往深处和阴影里退，要找有遮蔽的位置',
  cloudy: '多云天光照柔和，它更敢靠近浅水觅食',
  overcast: '阴天光线弱，是它一天里最放松的时候',
  rain: '下雨天溶氧高、食物被冲进水里，摄食会更积极',
  snow: '下雪前后的窗口很短，能钓的时间集中在气温稍高的那一段',
  fog: '雾天能见度低，岸边掠食更放得开',
  thunder: '雷雨前后气压变化大，常有短暂的爆口窗口（注意安全）',
}

function windReason(profile: SpeciesProfile, windPower: number | null): string | null {
  if (windPower === null || !profile.wind) return null
  if (profile.wind === 'windy' && windPower >= 2 && windPower <= 4) {
    return `风力 ${windPower} 级，风浪把表层食物搅到一处，正合它的习性`
  }
  if (profile.wind === 'calm' && windPower <= 2) {
    return `风力 ${windPower} 级、水面平稳，这类鱼不容易受惊`
  }
  return null
}

/** 关注时间段：低光鱼跟着真实日出日落走，有数据就用真实时刻 */
function describeTimeWindow(
  profile: SpeciesProfile,
  sunrise: string | null,
  sunset: string | null,
): string {
  switch (profile.activeTime) {
    case 'lowLight':
      return sunrise && sunset
        ? `日出前后（${sunrise} 左右）到上午，以及日落前 1 小时（${sunset} 前）`
        : '清晨与傍晚，天刚亮和天快黑的那两段'
    case 'night':
      return '天黑后 1 小时到午夜前后'
    case 'day':
      return '白天全时段，正午强光时可以歇一会儿'
    default:
      return '全天都有机会，不用挑时段'
  }
}

/* ------------------------------ 核心规则 ------------------------------ */

/** 通过硬条件筛选、并打过分的一个候选鱼种 */
export interface SpeciesCandidate {
  profile: SpeciesProfile
  score: number
  reasons: string[]
}

/** 筛选结果：当地「可能存在的鱼」+ 判断依据 */
export interface Screening {
  /** 通过分布 / 季节 / 水型 / 气温硬条件的候选，按分数从高到低 */
  candidates: SpeciesCandidate[]
  water: WaterType
  season: Season
  hemisphere: Hemisphere
  month: number
  /** 判断依据，一行一条，直接显示在卡片底部 */
  lines: string[]
}

export type ScreenResult =
  | { status: 'ok'; screening: Screening }
  | { status: 'insufficient'; message: string; hint: string; lines: string[] }

function rate(score: number): AdviceRating {
  if (score >= 8) return '值得尝试'
  if (score >= 5) return '可以关注'
  return '条件一般'
}

function basisLinesOf(
  input: AdviceInput,
  latitude: number | null,
  hemisphere: Hemisphere,
  water: WaterType,
): string[] {
  const { month, weather = null } = input
  const lines: string[] = []
  if (latitude !== null) {
    const abs = Math.abs(latitude)
    lines.push(
      `${month} 月 · ${hemisphere === 'n' ? '北' : '南'}半球 · 纬度 ${abs.toFixed(1)}°${
        hemisphere === 'n' ? 'N' : 'S'
      }`,
    )
  }
  lines.push(
    `水型：${WATER_LABELS[water]}${
      water === 'unknown'
        ? ''
        : input.waterOverride && input.waterOverride !== 'unknown'
          ? '（手动选择）'
          : '（按地名判断）'
    }`,
  )
  if (weather) {
    const bits = [`气温 ${Math.round(weather.temperatureC)}℃`]
    if (weather.humidityPercent !== null) bits.push(`湿度 ${Math.round(weather.humidityPercent)}%`)
    if (weather.windPower !== null) bits.push(`风力 ${weather.windPower} 级`)
    lines.push(`${weather.condition} · ${bits.join(' · ')}`)
  } else {
    lines.push('天气数据暂缺：只按季节、纬度与水域类型估算')
  }
  return lines
}

/**
 * 第一步：筛出「当地可能存在的鱼」。
 *
 * 这是整个推荐链路的地基：纬度带、半球、季节、水域类型、气温这五道硬条件
 * 不满足的鱼，直接不进候选。后面不管是本地规则排序还是交给 AI 分析，
 * 都只能在这个候选集合里做选择 —— AI 没有机会推荐一条当地压根没有的鱼。
 *
 * 纯函数：同样的输入永远得到同样的结果。
 */
export function screenSpecies(input: AdviceInput): ScreenResult {
  const { latitude, month, weather = null } = input
  const hemisphere: Hemisphere = latitude === null ? 'n' : hemisphereOf(latitude)

  const autoWater = inferWaterType(input.placeName)
  const water: WaterType =
    input.waterOverride && input.waterOverride !== 'unknown'
      ? input.waterOverride
      : autoWater

  const lines = basisLinesOf(input, latitude, hemisphere, water)

  if (latitude === null) {
    return {
      status: 'insufficient',
      message: INSUFFICIENT_MESSAGE,
      hint: INSUFFICIENT_HINT,
      lines,
    }
  }

  const season = seasonOf(month, hemisphere)
  const temperature = weather ? weather.temperatureC : null
  const kind = weather ? weather.kind : null
  const windPower = weather ? weather.windPower : null
  const abs = Math.abs(latitude)

  const candidates: SpeciesCandidate[] = []

  for (const profile of SPECIES) {
    // ① 分布纬度带（用绝对值，南北半球通用）
    if (abs < profile.latBand[0] || abs > profile.latBand[1]) continue

    // ② 半球
    if (profile.hemispheres && !profile.hemispheres.includes(hemisphere)) continue

    // ③ 季节
    if (!profile.seasons.includes(season)) continue

    // ④ 水域类型：判断出来了就要匹配；海水鱼只在近海推荐
    const saltwater = profile.water.includes('sea')
    if (saltwater && water !== 'sea') continue
    if (!saltwater && water === 'sea') continue
    if (water !== 'unknown' && !profile.water.includes(water)) continue

    // ⑤ 气温：差得太远就不推荐（拿不到气温就不卡这一条）
    if (temperature !== null) {
      const [low, high] = profile.tempRange
      if (temperature < low - TEMP_TOLERANCE || temperature > high + TEMP_TOLERANCE) continue
    }

    /* ------------------------------ 打分 ------------------------------ */
    let score = 5
    const reasons: string[] = []

    if (temperature !== null) {
      const [low, high] = profile.tempRange
      if (temperature >= low && temperature <= high) {
        score += 3
        reasons.push(
          `当前气温 ${Math.round(temperature)}℃，正落在它 ${low}–${high}℃ 的活跃区间里`,
        )
      } else {
        score += 1
      }
    }

    if (profile.peak.includes(season)) {
      score += 2
      if (reasons.length < 1) reasons.push(`${month} 月正是它在当地最活跃的时候`)
    }

    if (kind) {
      if (profile.likes?.includes(kind)) {
        score += 1
        reasons.push(WEATHER_REASONS[kind])
      }
      if (profile.dislikes?.includes(kind)) score -= 2
    }

    const wind = windReason(profile, windPower)
    if (wind) {
      score += 1
      reasons.push(wind)
    }

    if (water !== 'unknown' && !saltwater) {
      reasons.push(`本地判断为${WATER_LABELS[water]}，正对它的主场`)
    }

    // 大风天对所有鱼种都是减分项：抛投精度和控饵都会变差
    if (windPower !== null && windPower >= STRONG_WIND_POWER) score -= 3

    // 拿不到气温时不要假装算得很准，整体压一档
    if (temperature === null) score -= 1

    candidates.push({ profile, score, reasons: reasons.slice(0, 2) })
  }

  if (candidates.length === 0) {
    return {
      status: 'insufficient',
      message: INSUFFICIENT_MESSAGE,
      hint: INSUFFICIENT_HINT,
      lines: [...lines, '当前纬度与季节下，资料表里没有能对上号的鱼种'],
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.profile.name.localeCompare(b.profile.name))

  return {
    status: 'ok',
    screening: { candidates, water, season, hemisphere, month, lines },
  }
}

/** 把筛选出来的候选变成界面上的一张推荐卡片 */
export function adviceOfCandidate(
  candidate: SpeciesCandidate,
  month: number,
  weather: WeatherNow | null,
  name: string,
): SpeciesAdvice {
  return {
    id: candidate.profile.id,
    name,
    rating: rate(candidate.score),
    reasons:
      candidate.reasons.length > 0
        ? candidate.reasons
        : [`${month} 月是它的活动期，整体条件一般，出勤时顺带留意`],
    timeWindow: describeTimeWindow(
      candidate.profile,
      weather?.sunriseLabel ?? null,
      weather?.sunsetLabel ?? null,
    ),
    tip: candidate.profile.tip,
  }
}

/** 候选鱼种的关注时间段（AI 推荐卡片沿用同一套措辞） */
export function candidateTimeWindow(
  candidate: SpeciesCandidate,
  weather: WeatherNow | null,
): string {
  return describeTimeWindow(
    candidate.profile,
    weather?.sunriseLabel ?? null,
    weather?.sunsetLabel ?? null,
  )
}

/**
 * 算出今天当地值得关注的鱼种（本地规则版）。
 *
 * 全部是纯函数：同样的输入永远得到同样的结果，方便单独测。
 */
export function recommendSpecies(input: AdviceInput): AdviceResult {
  const screen = screenSpecies(input)
  if (screen.status === 'insufficient') return screen

  const { candidates, water, month, lines } = screen.screening
  const advice = candidates
    .slice(0, MAX_ADVICE)
    .map((item) =>
      adviceOfCandidate(item, month, input.weather ?? null, item.profile.name),
    )

  return { status: 'ok', advice, water, lines }
}
