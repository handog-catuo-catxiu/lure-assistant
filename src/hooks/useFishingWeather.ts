import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadWeather, readCachedWeather } from '../lib/weather'
import type { WeatherNow } from '../lib/weather'
import { useCurrentLocation } from './useGeolocation'
import type { Coordinate } from '../lib/coord'
import type { LiveGeoPoint } from '../types/trip'

/**
 * 首页的天气。
 *
 * ## 定位只用高德，而且不另起一条循环
 *
 * 出勤中（`liveFix` 有值）直接借用**已经在跑的那条高德定位循环**的读数，
 * 不再单独发定位请求；平时用 `useCurrentLocation` 做一次定位，
 * 它是一次性的（`locateOnce`），不建立任何监听，用完即止。
 *
 * `recentFix` 记在模块作用域里：从首页切走再回来不会重新定位，
 * 也不会重复请求天气 —— 位置没变、天气缓存没过期就直接用缓存。
 *
 * ## 天气可能失败，但不能让首页垮掉
 *
 * 失败时状态是 error 并给出重试；有旧数据就把旧数据继续显示着，
 * 由页面标明「更新于几点」——是旧的就说是旧的。
 */

/** 这条定位记录多久算「还新鲜」，超过就重新定位一次（ms） */
const FIX_FRESH_MS = 15 * 60_000

/** 最近一次成功定位（模块级，跨组件挂载保留） */
let recentFix: { point: LiveGeoPoint; at: number } | null = null
/**
 * 是不是已经有一次自动定位还在路上。
 *
 * 组件卸载时会把它放回 false：刚进首页就切去别的页时，这一次定位的结果没人接了，
 * 等回到首页必须能重新定位，否则会永远停在「正在通过高德定位获取当前位置…」。
 * 定位成功过的话 `freshFixPoint()` 会拦住重复定位，所以正常切页不会多发请求。
 */
let autoLocating = false

function freshFixPoint(): Coordinate | null {
  if (!recentFix) return null
  if (Date.now() - recentFix.at > FIX_FRESH_MS) return null
  return { latitude: recentFix.point.latitude, longitude: recentFix.point.longitude }
}

export type WeatherStatus = 'locating' | 'loading' | 'ready' | 'error'

export interface FishingWeatherApi {
  status: WeatherStatus
  /** 当前天气；请求失败时可能是上一份缓存（此时 fromCache 为 true） */
  weather: WeatherNow | null
  /** 这份天气来自缓存，界面上必须标出更新时间 */
  fromCache: boolean
  /** 天气请求失败的原因 */
  error: string | null
  /** 定位失败的原因（和天气失败分开，两者原因不同） */
  locationError: string | null
  /** 天气与鱼种推荐用的坐标（WGS84，和高德地图那套转换无关） */
  point: Coordinate | null
  /** 这条读数来自高德退回的 IP 大致位置，只能当参考 */
  approximate: boolean
  /** 重新定位并重新取天气 */
  refresh: () => void
}

interface FishingWeatherOptions {
  /** 出勤中的实时读数：有就直接用，不再单独定位 */
  liveFix?: LiveGeoPoint | null
  /**
   * 用户选定的参考位置（例如首页选中的那个钓点）。
   * 有值时天气一律按它取，连定位都不发 —— 选了钓点就该看那个钓点的天气。
   * 调用方要保证这个对象在两次渲染之间是同一个引用（用 useMemo），
   * 否则每次渲染都会被当成「位置变了」而重新请求天气。
   */
  overridePoint?: Coordinate | null
}

export function useFishingWeather(options: FishingWeatherOptions = {}): FishingWeatherApi {
  const liveFix = options.liveFix ?? null
  const override = options.overridePoint ?? null

  const {
    status: locationStatus,
    position,
    error: locationError,
    ipBased,
    locate,
  } = useCurrentLocation()

  // 挂载那一刻手上的坐标：优先参考位置，其次实时读数，最后 15 分钟内定位过的
  const [seed] = useState<Coordinate | null>(freshFixPoint)
  const source = override ?? liveFix ?? position ?? seed

  /*
   * 挂着的那份天气先铺在界面上（有就显示，并标明「更新于」），
   * 新数据取回来再替换 —— 从别的页面切回首页不会先空一下。
   * 放在 state 初始化里做，effect 里就只剩发请求了。
   */
  const [weather, setWeather] = useState<WeatherNow | null>(() => {
    const first = override ?? seed ?? freshFixPoint()
    return first ? (readCachedWeather(first)?.data ?? null) : null
  })
  const [fromCache, setFromCache] = useState(weather !== null)
  const [status, setStatus] = useState<WeatherStatus>(weather ? 'ready' : 'loading')
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  /** 用户点了刷新：这一轮绕过天气缓存 */
  const forceRef = useRef(false)

  // 记下这次成功后拿到的定位，供下一次进首页复用
  useEffect(() => {
    if (position && position.source === 'device') {
      recentFix = { point: position, at: Date.now() }
    }
  }, [position])

  /*
   * 还没有坐标时自动定位一次（用的是高德那一套一次性定位，不建监听）。
   * 出勤中已经有持续定位的读数、或者用户自己选了参考位置，就不再单独发请求。
   */
  useEffect(() => {
    if (override || liveFix || autoLocating || freshFixPoint()) return
    autoLocating = true
    locate()
    return () => {
      // 卸载时这次定位还没回来：结果没人接，标记放开，下次进首页重新定位
      if (!freshFixPoint()) autoLocating = false
    }
  }, [override, liveFix, locate])

  // 坐标变了（或者用户点刷新）就取天气；同一个位置的重复请求由 weather 模块去重
  useEffect(() => {
    if (!source) return

    let cancelled = false
    const force = forceRef.current
    forceRef.current = false

    loadWeather(source, { force })
      .then((data) => {
        if (cancelled) return
        setWeather(data)
        setFromCache(false)
        setError(null)
        setStatus('ready')
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : '天气没取到，稍后再试。')
        // 有旧数据就继续显示旧数据（页面上标明时间），没有才整块报错
        const cached = readCachedWeather(source)
        if (cached) setWeather(cached.data)
        setFromCache(cached !== null)
        setStatus(cached ? 'ready' : 'error')
      })

    return () => {
      cancelled = true
    }
  }, [source, nonce])

  const refresh = useCallback(() => {
    forceRef.current = true
    // 用户主动点的刷新：立刻回到「加载中」，免得以为没反应。
    // 定位重复发不出去 —— useCurrentLocation 里有一次只允许一个请求在飞的判断。
    setStatus('loading')
    // 参考位置是用户选的钓点，跟设备定位无关，重新定位也改不了它
    if (!override) locate()
    setNonce((value) => value + 1)
  }, [locate, override])

  /*
   * 对外给的坐标必须**引用稳定**：调用方会把它传给逆地理编码等 hook，
   * 那些 hook 按「对象变了就是位置变了」来判断要不要重新查。
   * 每次渲染都新建一个字面量的话，它们会被判成「位置一直在变」而反复发请求，
   * 首页就会一直重渲染停不下来（曾经真的这样卡住过）。
   */
  const point = useMemo(
    () => (source ? { latitude: source.latitude, longitude: source.longitude } : null),
    [source],
  )

  if (!point) {
    return {
      status:
        locationStatus === 'error' || locationStatus === 'unsupported' ? 'error' : 'locating',
      weather: null,
      fromCache: false,
      error: null,
      locationError,
      point: null,
      approximate: false,
      refresh,
    }
  }

  return {
    status,
    weather,
    fromCache,
    error,
    locationError: null,
    point,
    // 参考位置是自己选的钓点，跟 IP 大致定位无关
    approximate: override ? false : ipBased || position?.source === 'ip',
    refresh,
  }
}
