/**
 * 首页「今日推荐鱼种」的数据源。
 *
 * 分工是这样的：
 *   1. 本地规则先把当地「可能存在的鱼」筛出来（不联网、不花钱）；
 *   2. 有候选、且 AI 服务可用时，把它们连同真实天气、季节、水型交给 DeepSeek
 *      排序并写理由 —— AI 只能在这些候选里挑，挑不出别的鱼；
 *   3. AI 不可用、被限流、返回内容没通过校验，一律退回第 1 步的结果。
 *
 * 所以这个 hook 永远会给出一个 `result`：用户看到的推荐不会因为 AI 掉线而空掉，
 * 也不会因为 AI 胡说而多出一条当地没有的鱼。当前用的是哪一种，由 `source` 说明。
 *
 * 两条容易踩的坑，这里都堵上了：
 *   - **条件还在变的时候不发请求**：定位、地名、天气是接连到位的，见 AI_SETTLE_MS；
 *   - **状态不会永远停在「正在分析」**：只有当前这份条件的请求真的在飞才是 loading，
 *     否则一律落回「本地规则」并如实说明，见下面的 aiStatus。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AI_MODEL_LABEL,
  adviceCacheKey,
  adviceFromAi,
  buildAdviceMessages,
  buildGrounding,
  candidateIds,
  checkAiHealth,
  markRequest,
  msUntilNextRequest,
  readCachedAdvice,
  requestAdvice,
  resetAiHealth,
  writeCachedAdvice,
  type AiAdvice,
  type AiHealth,
  type GroundingPlace,
} from '../lib/fish/ai'
import {
  adviceOfCandidate,
  screenSpecies,
  MAX_ADVICE,
  type AdviceInput,
  type AdviceResult,
  type Screening,
} from '../lib/fish/recommend'
import { speciesDisplayName } from '../lib/fish/encyclopedia'
import type { WaterType } from '../lib/fish/species'
import type { WeatherNow } from '../lib/weather'

export type AdviceSource = 'rule' | 'ai'

/**
 * 条件（位置 / 地名 / 天气 / 水型）稳定多久之后才真的去调 AI（毫秒）。
 * 首页刚进来时这几样是接连到位的，不等一下就会连发几次、互相打断。
 */
const AI_SETTLE_MS = 1200

export type AiStatus =
  /** 正在确认这条链路上有没有可用的 AI */
  | 'checking'
  /** 正在等模型返回 */
  | 'loading'
  /** 这一份推荐来自 AI */
  | 'ready'
  /** 没有配置 / 服务端没配密钥：本次用本地规则 */
  | 'disabled'
  /** 调用失败或被限流：本次用本地规则 */
  | 'failed'
  /** 候选鱼种不足，不值得调用 AI */
  | 'skipped'

export interface FishAdviceApi {
  result: AdviceResult
  source: AdviceSource
  aiStatus: AiStatus
  /** 状态说明，直接显示在卡片底部；不需要说明时为 null */
  aiMessage: string | null
  /** 本地筛出来的候选鱼种数量（AI 只能从这里挑）；没有候选时为 null */
  candidateCount: number | null
  /** true = 手动重新分析还在冷却中 */
  throttled: boolean
  retry: () => void
}

export interface FishAdviceParams {
  latitude: number | null
  longitude: number | null
  /** 用来推断水域类型的名字：选了钓点就是钓点名 */
  placeName: string | null
  /** 展示用的位置描述 */
  placeLabel: string | null
  /** spot = 用户选了具体钓点；region = 只有当前位置，按区域鱼情参考 */
  scope: 'spot' | 'region'
  month: number
  /** 今天的日期文字，由 useNow 提供（渲染里不读时钟） */
  todayLabel: string
  /** 当前时间戳，同样来自 useNow */
  now: number
  waterOverride: WaterType
  weather: WeatherNow | null
}

interface LiveAdvice {
  key: string
  advice: AiAdvice
}

interface FailureNote {
  key: string
  message: string
}

export function useFishAdvice(params: FishAdviceParams): FishAdviceApi {
  const {
    latitude,
    longitude,
    placeName,
    placeLabel,
    scope,
    month,
    todayLabel,
    now,
    waterOverride,
    weather,
  } = params

  /* ------------------------------ 本地筛选（永远先算） ------------------------------ */

  const input: AdviceInput = useMemo(
    () => ({
      latitude,
      longitude,
      month,
      placeName,
      waterOverride,
      weather,
    }),
    [latitude, longitude, month, placeName, waterOverride, weather],
  )

  const screening = useMemo(() => screenSpecies(input), [input])

  const ruleResult: AdviceResult = useMemo(() => {
    if (screening.status === 'insufficient') return screening
    const { candidates, water, month: screenMonth, lines } = screening.screening
    const advice = candidates
      .slice(0, MAX_ADVICE)
      .map((candidate) =>
        adviceOfCandidate(
          candidate,
          screenMonth,
          weather,
          speciesDisplayName(candidate.profile.id, candidate.profile.name),
        ),
      )
    return { status: 'ok', advice, water, lines }
  }, [screening, weather])

  /* ------------------------------ AI 底稿 ------------------------------ */

  const place: GroundingPlace | null = useMemo(
    () =>
      latitude !== null && longitude !== null && placeLabel
        ? { label: placeLabel, scope, latitude, longitude }
        : null,
    [latitude, longitude, placeLabel, scope],
  )

  const grounding = useMemo(
    () => buildGrounding({ input, place, todayLabel }),
    [input, place, todayLabel],
  )

  const groundingKey = grounding ? adviceCacheKey(grounding) : null

  /* ------------------------------ AI 状态 ------------------------------ */

  const [health, setHealth] = useState<AiHealth | null>(null)
  const [live, setLive] = useState<LiveAdvice | null>(null)
  const [failure, setFailure] = useState<FailureNote | null>(null)
  /** 正在等模型回话的那份条件的 key；不是这份条件就说不上「正在分析」 */
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const manualRef = useRef(false)
  /** 已经发出去、还在等回话的那次请求。只用来在卸载时收尾 */
  const inFlightRef = useRef<AbortController | null>(null)

  // 组件卸载（切走首页、退出）时取消在飞的请求，别让它回来改一个已经不在的组件
  useEffect(
    () => () => {
      inFlightRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    if (!grounding || !groundingKey) return

    const key = groundingKey
    const allowedIds = candidateIds(grounding)
    const manual = manualRef.current
    manualRef.current = false

    /*
     * 等条件稳定下来再花钱。
     *
     * 刚进首页时定位 → 地名 → 天气是接连到位的，每到位一次 grounding 就换一个 key。
     * 如果一有变量就发请求，前面几次全都白花，而且新旧请求还会互相打断
     * （旧的被 abort，新的又被 60 秒节流拦住，页面上永远停在「正在分析」）。
     * 这个延时里条件又变了的话，上一轮 effect 的清理会把这个定时器清掉，等于没发过。
     */
    const timer = window.setTimeout(() => {
      void (async () => {
        const probe = await checkAiHealth()
        setHealth(probe)
        if (!probe.enabled) return

        // 缓存还在就直接用，不再花一次钱
        if (readCachedAdvice(grounding, allowedIds, Date.now())) return

        const wait = msUntilNextRequest(Date.now())
        if (wait > 0) {
          // 自动路径被节流时安静地用本地规则；用户手动点了才给提示
          if (manual) {
            setFailure({
              key,
              message: `请求太频繁，${Math.ceil(wait / 1000)} 秒后可以重新分析`,
            })
          }
          return
        }

        const controller = new AbortController()
        inFlightRef.current = controller
        markRequest(Date.now())
        setPendingKey(key)

        const outcome = await requestAdvice({
          messages: buildAdviceMessages(grounding),
          allowedIds,
          signal: controller.signal,
        })
        inFlightRef.current = null
        setPendingKey((current) => (current === key ? null : current))

        /*
         * 结果按它自己的 key 记账：条件已经变了的话，这份结果会写进缓存，
         * 但不会显示出来（下面 activeAi 只认当前 key），不会被当成当前的鱼情。
         */
        if (outcome.ok) {
          writeCachedAdvice(grounding, outcome.advice)
          setLive({ key, advice: outcome.advice })
          setFailure(null)
        } else if (outcome.failure.reason !== 'offline') {
          // offline 里包含「调用方主动取消」，那不是失败，不该弹一句吓人的话
          setFailure({ key, message: outcome.failure.message })
        }
      })()
    }, AI_SETTLE_MS)

    return () => window.clearTimeout(timer)
  }, [grounding, groundingKey, attempt])

  /** 正在用的 AI 结果：本次会话刚拿到的，或者缓存里仍然有效的 */
  const cached = useMemo(
    () =>
      grounding && groundingKey
        ? readCachedAdvice(grounding, candidateIds(grounding), now)
        : null,
    [grounding, groundingKey, now],
  )

  const activeAi = live && live.key === groundingKey ? live.advice : cached
  const activeFailure = failure && failure.key === groundingKey ? failure : null

  const aiAdvice = useMemo(() => {
    if (!activeAi || screening.status !== 'ok') return null
    const advice = adviceFromAi(activeAi.items, screening.screening, weather)
    return advice.length > 0 ? advice : null
  }, [activeAi, screening, weather])

  const source: AdviceSource = aiAdvice ? 'ai' : 'rule'

  const result: AdviceResult = useMemo(() => {
    if (!aiAdvice || screening.status !== 'ok') return ruleResult
    const screeningInfo: Screening = screening.screening
    const lines = [...screeningInfo.lines, `分析：${AI_MODEL_LABEL}（只在下列当地鱼种中排序）`]
    if (activeAi?.regionNote) lines.push(`区域鱼情：${activeAi.regionNote}`)
    return { status: 'ok', advice: aiAdvice, water: screeningInfo.water, lines }
  }, [aiAdvice, screening, ruleResult, activeAi])

  const aiStatus: AiStatus = useMemo(() => {
    if (source === 'ai') return 'ready'
    if (!grounding) {
      // 没有位置或候选不足：规则表自己都会说「数据不足」，这里不用再解释一遍
      return 'skipped'
    }
    if (!health) return 'checking'
    if (!health.enabled) return 'disabled'
    // 只有「这份条件」的请求真的在飞，才算正在分析
    if (pendingKey !== null && pendingKey === groundingKey) return 'loading'
    if (activeFailure) return 'failed'
    /*
     * 既没在请求、也没失败：就是这一轮没打算调（刚被节流、条件变了、
     * 或者结果已经过期）。老老实实按本地规则显示，不要一直挂着「正在分析」。
     */
    return 'skipped'
  }, [source, grounding, health, groundingKey, pendingKey, activeFailure])

  const aiMessage: string | null = useMemo(() => {
    switch (aiStatus) {
      case 'ready':
        return null
      case 'checking':
        return '正在确认 AI 服务…'
      case 'loading':
        return `正在把当地鱼种与实时天气交给 ${AI_MODEL_LABEL} 分析…`
      case 'disabled':
        return `本次由本地规则推荐：${health?.detail ?? 'AI 服务未启用'}`
      case 'failed':
        return `本次由本地规则推荐：${activeFailure?.message ?? 'AI 分析暂时不可用'}`
      default:
        return null
    }
  }, [aiStatus, health, activeFailure])

  const retry = useCallback(() => {
    manualRef.current = true
    resetAiHealth()
    setFailure(null)
    setAttempt((value) => value + 1)
  }, [])

  const throttled = useMemo(() => msUntilNextRequest(now) > 0, [now])

  const candidateCount = screening.status === 'ok' ? screening.screening.candidates.length : null

  return { result, source, aiStatus, aiMessage, candidateCount, throttled, retry }
}
