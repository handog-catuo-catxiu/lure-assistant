/**
 * 和代理服务打交道的地方。
 *
 * 这里只发两种请求：
 *   - GET  /ai/health       —— 问一句「这条链路上有没有可用的 AI」
 *   - POST /ai/fish-advice  —— 把提示词交给代理，由代理带上服务端密钥去调 DeepSeek
 *
 * 请求体里**没有、也不可能有 API Key**：浏览器根本不知道它是什么。
 * 任何失败都翻译成一句人话，交给上层决定要不要退回本地规则。
 */
import { AI_ADVICE_PATH, AI_HEALTH_PATH, aiEndpoint } from './config'
import { parseAdvice } from './parse'
import type { AdviceMessages } from './prompt'
import type { AiHealth, AiOutcome } from './types'

const HEALTH_TIMEOUT_MS = 6000
const ADVICE_TIMEOUT_MS = 30000

/** 给 fetch 加超时，并且跟随调用方的取消信号 */
function withTimeout(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()

  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort)
  }

  return {
    signal: controller.signal,
    done(): void {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
  }
}

/** 探活结果在一个页面会话里只问一次，别每开一次首页都戳一下代理 */
let healthProbe: Promise<AiHealth> | null = null

function offlineDetail(): string {
  return typeof navigator !== 'undefined' && navigator.onLine === false
    ? '当前设备处于离线状态'
    : '连不上 AI 服务'
}

async function probeHealth(signal?: AbortSignal): Promise<AiHealth> {
  const timeout = withTimeout(signal, HEALTH_TIMEOUT_MS)
  try {
    const response = await fetch(aiEndpoint(AI_HEALTH_PATH), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: timeout.signal,
    })
    if (!response.ok) {
      return { enabled: false, model: null, detail: offlineDetail() }
    }
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object') {
      return { enabled: false, model: null, detail: 'AI 服务返回了看不懂的内容' }
    }
    const obj = data as Record<string, unknown>
    const model = typeof obj.model === 'string' ? obj.model : null
    const detail = typeof obj.detail === 'string' ? obj.detail : null
    return { enabled: obj.enabled === true, model, detail }
  } catch {
    return { enabled: false, model: null, detail: offlineDetail() }
  } finally {
    timeout.done()
  }
}

/** 探活：结果在会话内缓存，同时避免并发重复请求 */
export function checkAiHealth(signal?: AbortSignal): Promise<AiHealth> {
  if (!healthProbe) {
    healthProbe = probeHealth(signal)
  }
  return healthProbe
}

/** 手动重试时把会话缓存清掉，重新问一次 */
export function resetAiHealth(): void {
  healthProbe = null
}

interface AdviceResponse {
  ok?: unknown
  model?: unknown
  content?: unknown
  error?: unknown
  message?: unknown
}

const FAILURE_MESSAGES: Record<string, string> = {
  'no-key': 'AI 服务还没配置密钥',
  'rate-limited': '请求太频繁了，稍后再试',
  budget: '今天的 AI 额度已经用完',
  upstream: 'AI 服务暂时不可用',
  'bad-request': '请求格式不被接受',
  network: '连不上 AI 服务',
}

export interface AdviceRequest {
  messages: AdviceMessages
  /** 候选鱼种 id，用于校验返回内容 */
  allowedIds: string[]
  signal?: AbortSignal
}

/**
 * 把提示词发给代理，拿回一条条校验过的推荐。
 * 返回的 items 里每一个 speciesId 都已经确认过在候选列表里。
 */
export async function requestAdvice({
  messages,
  allowedIds,
  signal,
}: AdviceRequest): Promise<AiOutcome> {
  const timeout = withTimeout(signal, ADVICE_TIMEOUT_MS)
  try {
    const response = await fetch(aiEndpoint(AI_ADVICE_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      // 只发两条消息，模型、max_tokens、温度全部由服务端决定：这样这台代理
      // 没法被当成通用大模型接口滥用，成本也就封在一个很小的上限里
      body: JSON.stringify({
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
      }),
      signal: timeout.signal,
    })

    let data: AdviceResponse | null = null
    try {
      data = (await response.json()) as AdviceResponse
    } catch {
      data = null
    }

    if (response.status === 429) {
      // 限流和额度用尽都走 429，但话不一样：服务端给了 message 就用它的
      const code = typeof data?.error === 'string' ? data.error : ''
      const serverMessage = typeof data?.message === 'string' ? data.message : null
      return {
        ok: false,
        failure: {
          reason: 'rate-limited',
          message: serverMessage ?? FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES['rate-limited'],
        },
      }
    }

    if (!response.ok || !data || data.ok !== true) {
      const code = typeof data?.error === 'string' ? data.error : ''
      const serverMessage = typeof data?.message === 'string' ? data.message : null
      const reason = code === 'no-key' ? 'disabled' : 'server'
      return {
        ok: false,
        failure: {
          reason,
          message:
            code === 'rate-limited'
              ? FAILURE_MESSAGES['rate-limited']
              : (serverMessage ?? FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.upstream),
        },
      }
    }

    const content = typeof data.content === 'string' ? data.content : ''
    const parsed = parseAdvice(content, allowedIds)
    if (!parsed) {
      return {
        ok: false,
        failure: {
          reason: 'invalid',
          message: '这次的分析结果没通过校验，已用本地规则替代',
        },
      }
    }

    return {
      ok: true,
      advice: {
        items: parsed.items,
        regionNote: parsed.regionNote,
        model: typeof data.model === 'string' ? data.model : 'deepseek-chat',
        generatedAt: Date.now(),
      },
    }
  } catch {
    if (signal?.aborted) {
      // 调用方主动取消（组件卸载、位置变了），不算失败，安静地结束
      return { ok: false, failure: { reason: 'offline', message: '请求已取消' } }
    }
    return {
      ok: false,
      failure: { reason: 'offline', message: FAILURE_MESSAGES.network },
    }
  } finally {
    timeout.done()
  }
}
