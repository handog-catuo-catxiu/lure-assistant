/**
 * AI 分析层的类型。
 *
 * 这一层只负责「把已经筛好的当地鱼种交给 AI 排个序、写句理由」，
 * 不负责判断当地有没有这条鱼 —— 那是 screenSpecies() 的活。
 * 所以这里的每个条目都带 speciesId，界面上取名字、取详情一律回百科查。
 */

/** AI 给的关注度，只有三档，和本地规则的措辞一一对应 */
export type AiRating = 'high' | 'mid' | 'low'

export const AI_RATINGS: readonly AiRating[] = ['high', 'mid', 'low']

export interface AiAdviceItem {
  /** 必须是候选列表里的 id —— 解析时会逐个校验，不在列表里的直接丢掉 */
  speciesId: string
  rating: AiRating
  /** 为什么现在、在这里值得关注它（要引用真实的月份 / 气温 / 水型） */
  reason: string
  /** 一句可执行的操作建议 */
  tip: string
}

export interface AiAdvice {
  items: AiAdviceItem[]
  /** AI 对这片水域的一句概述；没给就是 null，界面不补写 */
  regionNote: string | null
  /** 实际使用的模型名，界面上署名用 */
  model: string
  /** 拿到这份结果的时间戳 */
  generatedAt: number
}

export type AiFailureReason =
  /** 没有配置代理地址，或代理那边没配 key —— 界面直接退回本地规则 */
  | 'disabled'
  /** 网络没通 / 超时 */
  | 'offline'
  /** 被限流（本机太频繁，或服务端额度用完） */
  | 'rate-limited'
  /** 服务端返回了错误 */
  | 'server'
  /** 返回的内容不是能用的 JSON，或提到了候选之外的鱼 */
  | 'invalid'

export interface AiFailure {
  reason: AiFailureReason
  /** 给用户看的一句话，不暴露任何密钥或内部细节 */
  message: string
}

export type AiOutcome = { ok: true; advice: AiAdvice } | { ok: false; failure: AiFailure }

/** 服务端 /ai/health 的返回，用来判断这条链路上有没有可用的 AI */
export interface AiHealth {
  enabled: boolean
  model: string | null
  /** 没启用时的一句话原因，界面上可以如实解释为什么退回本地规则 */
  detail: string | null
}
