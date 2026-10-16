/**
 * AI 推荐层的对外入口。
 *
 * 一句话概括这一层的分工：
 *   screenSpecies()  →  决定「当地可能有哪些鱼」（本地数据，不联网）
 *   buildGrounding() →  把这些鱼的事实整理成底稿
 *   buildAdviceMessages() / requestAdvice()  →  交给 DeepSeek 排序、写理由
 *   parseAdvice() / adviceFromAi()  →  校验后再还原成本地数据的卡片
 *
 * 任何一步出问题，调用方都会退回纯规则推荐 —— 用户看到的推荐永远有依据。
 */
export { AI_MODEL_LABEL, aiEndpoint, getAiProxyBase } from './config'
export { checkAiHealth, requestAdvice, resetAiHealth } from './client'
export {
  adviceCacheKey,
  clearAdviceCache,
  markRequest,
  MIN_REQUEST_INTERVAL_MS,
  msUntilNextRequest,
  readCachedAdvice,
  writeCachedAdvice,
} from './cache'
export {
  buildGrounding,
  candidateIds,
  MAX_GROUNDING_CANDIDATES,
  MIN_AI_CANDIDATES,
  type Grounding,
  type GroundingPlace,
  type GroundingSpecies,
} from './grounding'
export { adviceFromAi, aiBasisLine } from './merge'
export { parseAdvice, MAX_ITEMS, MIN_ITEMS } from './parse'
export { AI_PROMPT_TAG, buildAdviceMessages, type AdviceMessages } from './prompt'
export type {
  AiAdvice,
  AiAdviceItem,
  AiFailure,
  AiFailureReason,
  AiHealth,
  AiOutcome,
  AiRating,
} from './types'
