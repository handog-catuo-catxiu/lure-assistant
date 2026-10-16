/**
 * 解析并校验 AI 返回的内容。
 *
 * 原则：**宁可作废，也不放行**。任何一条对不上本地事实的推荐（不在候选里、
 * rating 不认识、理由为空），整个结果就作废，由调用方退回本地规则。
 * 这样即使模型胡说，用户看到的也还是一份有依据的推荐。
 */
import { AI_RATINGS, type AiAdviceItem, type AiRating } from './types'

/** 最多接受几条推荐（需求是 3–4 条） */
export const MAX_ITEMS = 4
/** 至少要几条才算一次有效的 AI 推荐 */
export const MIN_ITEMS = 3
/** 理由 / 建议的长度上限，超了截断而不是作废 */
const REASON_MAX = 120
const TIP_MAX = 80
const NOTE_MAX = 80

export interface ParsedAdvice {
  items: AiAdviceItem[]
  regionNote: string | null
}

function asTrimmed(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** 从模型输出里抠出 JSON 对象：容忍 ```json 代码块和前后多余的话 */
function extractJsonObject(raw: string): unknown | null {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function isRating(value: unknown): value is AiRating {
  return typeof value === 'string' && (AI_RATINGS as readonly string[]).includes(value)
}

/**
 * @param raw 模型返回的正文
 * @param allowedIds 候选鱼种 id（白名单，来自 buildGrounding）
 */
export function parseAdvice(raw: string, allowedIds: string[]): ParsedAdvice | null {
  const parsed = extractJsonObject(raw)
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>
  const rawItems = obj.items
  if (!Array.isArray(rawItems)) return null

  const allowed = new Set(allowedIds)
  const seen = new Set<string>()
  const items: AiAdviceItem[] = []

  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>

    const speciesId = asTrimmed(item.speciesId, 64)
    if (!speciesId || !allowed.has(speciesId) || seen.has(speciesId)) continue

    const rating = isRating(item.rating) ? item.rating : null
    if (!rating) continue

    const reason = asTrimmed(item.reason, REASON_MAX)
    if (!reason) continue

    const tip = asTrimmed(item.tip, TIP_MAX)
    if (!tip) continue

    seen.add(speciesId)
    items.push({ speciesId, rating, reason, tip })
    if (items.length >= MAX_ITEMS) break
  }

  // 条数不够就当这次没成功：三言两语凑不齐，不如走本地规则
  if (items.length < Math.min(MIN_ITEMS, allowedIds.length)) return null

  return { items, regionNote: asTrimmed(obj.regionNote, NOTE_MAX) }
}
