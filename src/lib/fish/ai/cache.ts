/**
 * AI 结果的本地缓存与节流。
 *
 * 两个目的，都是钱和安全：
 *   1. **缓存**：同一片水域、同一个季节、同一档天气，三小时内不再重复调用 ——
 *      用户进进出出首页十次也只花一次的钱。
 *   2. **节流**：手动重试至少间隔 60 秒，避免有人对着按钮连点把额度刷光。
 *
 * 缓存只存「id + 评级 + 一句话理由」这些能复核的字段，不存模型原文；
 * 读回来之后仍然要拿当前候选列表再校验一遍，对不上就丢掉。
 */
import type { Grounding } from './grounding'
import { MAX_ITEMS } from './parse'
import { AI_RATINGS, type AiAdvice, type AiAdviceItem } from './types'

const CACHE_KEY = 'luremate:fish-advice:v1'
const THROTTLE_KEY = 'luremate:fish-advice-throttle:v1'

/** 缓存有效期：3 小时（天气和鱼情在半天内变化不大） */
export const CACHE_TTL_MS = 3 * 60 * 60 * 1000
/** 手动重试的最小间隔 */
export const MIN_REQUEST_INTERVAL_MS = 60 * 1000
/** 最多保留几份缓存 */
const MAX_ENTRIES = 6

interface CacheEntry {
  key: string
  at: number
  model: string
  regionNote: string | null
  items: AiAdviceItem[]
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    // 隐私模式、坏数据：一律当成没有缓存
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存不下不影响本次结果，只是下次还会再调用一次
  }
}

function readEntries(): CacheEntry[] {
  const parsed = readJson(CACHE_KEY)
  return Array.isArray(parsed) ? (parsed as CacheEntry[]) : []
}

function isRating(value: unknown): boolean {
  return typeof value === 'string' && (AI_RATINGS as readonly string[]).includes(value)
}

function readItems(value: unknown): AiAdviceItem[] | null {
  if (!Array.isArray(value)) return null
  const items: AiAdviceItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const item = entry as Record<string, unknown>
    if (
      typeof item.speciesId !== 'string' ||
      !isRating(item.rating) ||
      typeof item.reason !== 'string' ||
      typeof item.tip !== 'string'
    ) {
      return null
    }
    items.push({
      speciesId: item.speciesId,
      rating: item.rating as AiAdviceItem['rating'],
      reason: item.reason,
      tip: item.tip,
    })
  }
  return items.length > 0 && items.length <= MAX_ITEMS ? items : null
}

/**
 * 缓存键：这一份结果是在什么条件下算出来的。
 *
 * 位置取到 0.1°（约 11 km）—— 和天气的空间尺度差不多，同城范围内共用一份；
 * 天气只取「气温每 3℃ 一档 + 现象 + 风力」，避免温度抖一度就重新调用。
 */
export function adviceCacheKey(grounding: Grounding): string {
  const weather = grounding.weather
  const weatherKey = weather
    ? `${Math.round(weather.temperatureC / 3)}|${weather.condition}|${weather.windPower ?? 'x'}`
    : 'no-weather'
  return [
    grounding.place.latitude.toFixed(1),
    grounding.place.longitude.toFixed(1),
    grounding.place.scope,
    grounding.month,
    grounding.water,
    weatherKey,
  ].join('#')
}

/** 读缓存；过期、条件对不上、内容被改坏，一律返回 null */
export function readCachedAdvice(
  grounding: Grounding,
  allowedIds: string[],
  now: number,
): AiAdvice | null {
  const key = adviceCacheKey(grounding)
  const entry = readEntries().find((item) => item?.key === key)
  if (!entry) return null
  if (typeof entry.at !== 'number' || now - entry.at > CACHE_TTL_MS || now < entry.at) return null

  const items = readItems(entry.items)
  if (!items) return null

  const allowed = new Set(allowedIds)
  const filtered = items.filter((item) => allowed.has(item.speciesId))
  // 缓存的候选变了（季节、水型、位置变了），这份缓存就不该再用了
  if (filtered.length !== items.length || filtered.length === 0) return null

  return {
    items: filtered,
    regionNote: typeof entry.regionNote === 'string' ? entry.regionNote : null,
    model: typeof entry.model === 'string' ? entry.model : 'deepseek-chat',
    generatedAt: entry.at,
  }
}

/** 写缓存：同一条件覆盖旧的，最多留 MAX_ENTRIES 份 */
export function writeCachedAdvice(grounding: Grounding, advice: AiAdvice): void {
  const key = adviceCacheKey(grounding)
  const entry: CacheEntry = {
    key,
    at: advice.generatedAt,
    model: advice.model,
    regionNote: advice.regionNote,
    items: advice.items,
  }
  const rest = readEntries().filter((item) => item?.key !== key)
  writeJson(CACHE_KEY, [entry, ...rest].slice(0, MAX_ENTRIES))
}

/** 距离下一次允许发起请求还有多少毫秒；0 表示现在就可以 */
export function msUntilNextRequest(now: number): number {
  const raw = readJson(THROTTLE_KEY)
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  const elapsed = now - raw
  if (elapsed < 0) return 0
  return elapsed >= MIN_REQUEST_INTERVAL_MS ? 0 : MIN_REQUEST_INTERVAL_MS - elapsed
}

/** 记下「刚刚发过一次请求」 */
export function markRequest(now: number): void {
  writeJson(THROTTLE_KEY, now)
}

/** 清空缓存与节流记录（设置里「重新分析」用得上） */
export function clearAdviceCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(THROTTLE_KEY)
  } catch {
    // 清不掉也无所谓
  }
}
