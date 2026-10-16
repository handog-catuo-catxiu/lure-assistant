import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AmapLocationError,
  describeLocationFailure,
  getLastLocationNote,
  getLatestFix,
  locateOnce,
  startWatching,
  stopWatching,
} from '../lib/amap/geolocation'
import { saveLastFix } from '../lib/lastFix'
import type { GeoStatus } from '../lib/geo'
import type { LiveGeoPoint } from '../types/trip'

/**
 * 定位的两个入口，**统一走高德定位**（`lib/amap/geolocation.ts`）：
 *
 * - useCurrentLocation：一次性定位。用在开始出勤时「获取当前位置」，
 *   在地图上选点的起点，以及给没有位置的渔获补一个位置。
 * - useGeoWatcher：持续定位，出勤期间记录轨迹用，可暂停可恢复。
 *
 * 两个 hook 都只吐**真实读数**：拿不到就说拿不到，不会返回任何编出来的坐标。
 * 高德退回 IP 粗略定位时会照实带上 `source: 'ip'`，界面负责标成
 * 「IP 大致位置」，入库那一侧统一拒绝它。
 */

/* ---------------------------- 一次性定位 ---------------------------- */

export type OnceGeoStatus = 'idle' | 'locating' | 'success' | 'error' | 'unsupported'

export interface CurrentLocationApi {
  status: OnceGeoStatus
  position: LiveGeoPoint | null
  error: string | null
  /**
   * true 表示 position 是**上一次**成功定位留下的读数，这次没拿到新的。
   * 界面上必须写成「上次定位 + 时间」，不能摆在「当前坐标」的位置。
   */
  stale: boolean
  /** 这条读数是高德退回的 IP 粗略定位，只能当地图参考 */
  ipBased: boolean
  /** 定位进行中的说明 */
  hint: string | null
  /** 请求一次定位；正在进行中不会重复发请求 */
  locate: () => void
  reset: () => void
}

/** 点一次拿一次当前位置。用于开始出勤、地图选点的起点和补充渔获位置 */
export function useCurrentLocation(): CurrentLocationApi {
  const [status, setStatus] = useState<OnceGeoStatus>('idle')
  const [position, setPosition] = useState<LiveGeoPoint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  /** 这次定位有没有成功过（成功之后又失败，position 就是「上次的」） */
  const [fresh, setFresh] = useState(false)

  // 同步的进行中标记：连点两下不会发两次定位请求
  const pendingRef = useRef(false)
  // 组件卸载后不要再 setState
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const locate = useCallback(() => {
    if (pendingRef.current || !aliveRef.current) return

    pendingRef.current = true
    setStatus('locating')
    setError(null)
    setFresh(false)
    setHint('正在通过高德定位获取当前位置…')

    locateOnce()
      .then((fix) => {
        if (!aliveRef.current) return
        pendingRef.current = false
        setPosition(fix)
        setStatus('success')
        setError(null)
        setHint(null)
        setFresh(true)
        // 只有设备定位才值得记成「上次定位」：IP 位置当参考会误导人
        if (fix.source === 'device') void saveLastFix(fix)
      })
      .catch((failure: unknown) => {
        if (!aliveRef.current) return
        pendingRef.current = false
        const err =
          failure instanceof AmapLocationError
            ? failure
            : new AmapLocationError('FAILED', '定位失败，请稍后重试。', false)

        setStatus(err.code === 'NOT_SUPPORT' ? 'unsupported' : 'error')
        setHint(null)
        setError(describeLocationFailure(err))
      })
  }, [])

  const reset = useCallback(() => {
    pendingRef.current = false
    setStatus('idle')
    setPosition(null)
    setError(null)
    setHint(null)
    setFresh(false)
  }, [])

  // 手上这条读数算不算数：这次成功了才算，否则只要还有位置，就是「上次的」
  const stale = position !== null && !fresh

  return {
    status,
    position,
    error,
    stale,
    ipBased: position !== null && position.source === 'ip',
    hint,
    locate,
    reset,
  }
}

/* ---------------------------- 持续定位 ---------------------------- */

export interface GeoWatcherApi {
  status: GeoStatus
  /** 最近一次定位读数；`source` 说明是设备定位还是 IP 大致位置 */
  position: LiveGeoPoint | null
  /** 硬失败（权限被拒、没配 Key、插件没加载出来）——循环已经停了 */
  error: string | null
  /**
   * 软失败：定位循环还在跑，只是这一会儿没拿到读数。
   * 和 error 分开，是因为它不代表「定位坏了」，不该吓唬人。
   */
  warning: string | null
  /**
   * 刚才从后台回到前台。iPhone 锁屏 / 切后台时网页定位会被暂停，
   * 回来之后轨迹可能出现断点，界面要如实说明，不要假装一直在记录。
   */
  backgrounded: boolean
  /** 是否正在持续定位 */
  watching: boolean
  startWatch: () => void
  /** 暂停定位：保留已经采到的点，不清除任何数据 */
  pauseWatch: () => void
  /** 停掉当前循环再重新开一个：定位卡住时用它，不会留下第二条循环 */
  restartWatch: () => void
  /** 立刻再取一次位置（不改变持续定位状态） */
  refresh: () => void
  /** 最新读数，不受界面更新节奏影响，一键上鱼写位置用它 */
  getLatest: () => LiveGeoPoint | null
}

/**
 * 持续定位多久还没拿到第一条读数，就不再显示「定位中」了。
 * 高德那边单次定位最长 15 秒，再加上 IP 兜底，40 秒足够；
 * 到这个点还没结果，就当这一轮定位失败，给用户一个「重新尝试定位」。
 */
const STALL_TIMEOUT_MS = 40_000

interface GeoWatcherOptions {
  /**
   * 每次拿到真实读数时同步回调一次（不走 React 状态，因此不会引起渲染）。
   * 轨迹记录用它采点。
   */
  onPosition?: (point: LiveGeoPoint) => void
}

/** 持续定位。同一时间只会有一条采点循环，停止时一条都不留 */
export function useGeoWatcher(options: GeoWatcherOptions = {}): GeoWatcherApi {
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [position, setPosition] = useState<LiveGeoPoint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [backgrounded, setBackgrounded] = useState(false)
  const [watching, setWatching] = useState(false)

  const aliveRef = useRef(true)
  /** 同步记录「有没有在跑」：startWatch 连点也不会开出第二条循环 */
  const watchingRef = useRef(false)
  const stallTimerRef = useRef<number | null>(null)

  // 用 ref 转一层，父组件每次渲染传新函数也不会重启定位
  const onPositionRef = useRef(options.onPosition)
  useEffect(() => {
    onPositionRef.current = options.onPosition
  }, [options.onPosition])

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
  }, [])

  /** 拿到一条真实读数：先喂采集回调，再更新界面，最后撤掉各种告警 */
  const applyFix = useCallback((fix: LiveGeoPoint) => {
    if (!aliveRef.current) return
    clearStallTimer()

    onPositionRef.current?.(fix)
    setPosition(fix)
    /*
     * 循环在跑才算「定位正常」。手动刷一下拿到读数、但循环停着（暂停中、
     * 或者一直没启动）时，状态不能跟着变成「正在记录轨迹」——那是在骗人。
     */
    setStatus(watchingRef.current ? 'watching' : 'paused')
    setError(null)
    setBackgrounded(false)

    // 定位本身是成功的，但坐标转换没通这类问题也要说清楚，不能默默偏几百米
    setWarning(getLastLocationNote())

    if (fix.source === 'device') void saveLastFix(fix)
  }, [clearStallTimer])

  const applyFailure = useCallback(
    (failure: AmapLocationError) => {
      if (!aliveRef.current) return

      if (failure.fatal) {
        // 权限被拒 / 没配 Key / 插件没加载出来：循环已经停了，如实报错
        clearStallTimer()
        setStatus(failure.code === 'PERMISSION_DENIED' ? 'denied' : 'error')
        setError(describeLocationFailure(failure))
        setWarning(null)
        return
      }

      // 这一轮没拿到读数，但循环还在跑：只提示，不把状态说成「定位失败」，
      // 否则界面会一直闪「失败」，而它下一轮可能就正常了
      setWarning(describeLocationFailure(failure))
    },
    [clearStallTimer],
  )

  const startWatch = useCallback(() => {
    // 已经在跑就直接返回，绝不起第二条循环
    if (watchingRef.current) return

    watchingRef.current = true
    setWatching(true)
    setStatus('locating')
    setError(null)
    setWarning(null)

    startWatching(applyFix, applyFailure)

    // 兜底：一直没结果时不再显示「定位中」，而是给出失败和重试
    clearStallTimer()
    stallTimerRef.current = window.setTimeout(() => {
      stallTimerRef.current = null
      if (!aliveRef.current) return
      setStatus('error')
      setWarning('持续定位超时了：一直没有拿到读数。可以点「重新尝试定位」，或者先继续出勤——轨迹会从拿到定位那一刻开始记。')
    }, STALL_TIMEOUT_MS)
  }, [applyFix, applyFailure, clearStallTimer])

  const pauseWatch = useCallback(() => {
    watchingRef.current = false
    setWatching(false)
    clearStallTimer()
    stopWatching()
    if (!aliveRef.current) return
    // 只是停下来，已经记录的轨迹点一个都不动
    setStatus((current) =>
      current === 'denied' || current === 'unsupported' ? current : 'paused',
    )
  }, [clearStallTimer])

  /**
   * 重新开始定位：先停掉手上的循环，再开一个新的。
   * 这样「暂停 → 继续」和「卡住了点重试」都只有一条循环，不会叠加。
   */
  const restartWatch = useCallback(() => {
    watchingRef.current = false
    clearStallTimer()
    stopWatching()
    startWatch()
  }, [clearStallTimer, startWatch])

  const refresh = useCallback(() => {
    locateOnce()
      .then(applyFix)
      .catch((failure: unknown) => {
        applyFailure(
          failure instanceof AmapLocationError
            ? failure
            : new AmapLocationError('FAILED', '定位失败，请稍后重试。', false),
        )
      })
  }, [applyFix, applyFailure])

  const getLatest = useCallback(() => getLatestFix(), [])

  // 回到前台：补一次定位，让轨迹尽快接上
  useEffect(() => {
    if (!watching) return

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // iOS 可能在这里就把定位挂起了，回来时要如实提示
        setBackgrounded(true)
        return
      }
      refresh()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onVisibilityChange)
    }
  }, [watching, refresh])

  // 卸载（含结束出勤、页面切换）时一定要停掉循环和定时器。
  // 全应用只有 useTripTrack 一个消费者，所以这里停掉的不会伤到别人。
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      clearStallTimer()
      if (watchingRef.current) {
        watchingRef.current = false
        stopWatching()
      }
    }
  }, [clearStallTimer])

  return {
    status,
    position,
    error,
    warning,
    backgrounded,
    watching,
    startWatch,
    pauseWatch,
    restartWatch,
    refresh,
    getLatest,
  }
}
