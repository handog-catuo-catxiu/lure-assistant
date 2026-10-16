import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGeoWatcher } from './useGeolocation'
import { filterTrackPoint, summarizeTrack } from '../lib/geo'
import { toIdbErrorMessage } from '../lib/idb'
import { getTrackPoints, putTrackPoint, toTrackPoint } from '../lib/trackStore'
import type { GeoStatus, TrackSummary } from '../lib/geo'
import type { LiveGeoPoint, TrackPoint } from '../types/trip'

/**
 * 出勤期间的 GPS 轨迹记录。
 *
 * 分工：
 * - 定位本身交给 useGeoWatcher（高德定位，全局只有一条采点循环）
 * - 过滤交给 lib/geo 的纯函数（精度差、抖动、跳点、IP 粗略定位都在那里挡掉）
 * - 落库交给 lib/trackStore（IndexedDB，不碰 localStorage）
 *
 * 关于渲染：定位回调可能每秒都来，但轨迹点**不直接**进 React 状态，
 * 而是先攒在 ref 里，每 2 秒或攒够 5 个点才合并进状态一次，
 * 这样不会因为 GPS 高频回调把整个应用反复重渲染。
 */

/** 攒多久把轨迹点合并进状态一次 */
const FLUSH_INTERVAL_MS = 2_000
/** 攒够多少个点就立刻合并（走路快的时候不至于看着卡住） */
const FLUSH_BATCH = 5

export interface TripTrackApi {
  /** 当前正在记录的出勤；没有出勤时为 null */
  sessionId: string | null
  status: GeoStatus
  /** 硬失败：权限被拒、浏览器不支持（监听已停） */
  error: string | null
  /** 软提示：监听还在跑，只是这一会儿没拿到读数 */
  warning: string | null
  /** 刚回到前台：期间轨迹可能断档 */
  backgrounded: boolean
  /** 用户是否开着轨迹记录 */
  recording: boolean
  /** 最近一次定位读数（GPS 卡片和轨迹地图都读它，保证两处显示一致） */
  latest: LiveGeoPoint | null
  /** 已经记录的轨迹点，按时间升序 */
  points: TrackPoint[]
  summary: TrackSummary
  /** 历史轨迹是否已经从 IndexedDB 读回来了 */
  ready: boolean
  /** 轨迹写不进 IndexedDB 时的提示；null 表示正常 */
  storageError: string | null
  start: () => void
  pause: () => void
  /** 重新开始监听（监听卡住时用）：先停旧循环再开新的，不会留下第二条 */
  restart: () => void
  refresh: () => void
  /** 最新读数（不受界面更新节奏影响），一键上鱼写位置用 */
  getLatestPosition: () => LiveGeoPoint | null
}

interface TripTrackOptions {
  /** 要记录轨迹的出勤；null 表示没有进行中的出勤 */
  sessionId: string | null
  /** 是否允许记录（用户在这次出勤里同意过记轨迹） */
  enabled: boolean
}

/** 已经读进来的轨迹 + 它属于哪一场 */
interface TrackLoad {
  sessionId: string
  points: TrackPoint[]
  ready: boolean
  error: string | null
}

/** 用户手动改过的记录开关，连同它属于哪一场 */
interface Override {
  sessionId: string
  recording: boolean
}

export function useTripTrack({ sessionId, enabled }: TripTrackOptions): TripTrackApi {
  /*
   * 已经读进来的轨迹，连同它属于哪一场出勤一起存。
   * 这样换一场出勤时不用在 effect 里清空状态：sessionId 对不上就等于「还没读好」。
   */
  const [loaded, setLoaded] = useState<TrackLoad>({
    sessionId: '',
    points: [],
    ready: false,
    error: null,
  })

  /*
   * 用户在这次出勤里手动按过「开始 / 暂停记录」。
   * 记下是哪一场，换一场出勤就自动回到开始出勤时选的默认状态，
   * 不需要再用一个 effect 去同步。
   */
  const [override, setOverride] = useState<Override | null>(null)

  /** 当前是否在记：用户手动改过就听手动那次，否则听开始出勤时的选择 */
  const recording =
    sessionId !== null &&
    (override !== null && override.sessionId === sessionId
      ? override.recording
      : enabled)

  const pointsRef = useRef<TrackPoint[]>([])
  /** 等待合并进状态的暂存区 */
  const bufferRef = useRef<TrackPoint[]>([])
  /** 上一个被接受的轨迹点，过滤规则要和它比 */
  const lastKeptRef = useRef<TrackPoint | null>(null)
  const flushTimerRef = useRef<number | null>(null)

  // 采集回调里要读到最新的 sessionId / 开关，用 ref 同步，避免回调被反复重建
  const sessionIdRef = useRef(sessionId)
  const recordingRef = useRef(recording)

  // 每次渲染后把最新的值同步给 ref（只写 ref，不触发渲染）
  useEffect(() => {
    sessionIdRef.current = sessionId
    recordingRef.current = recording
  })

  /** 把暂存区合并进状态（同时清空暂存区） */
  const flush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }

    const activeSessionId = sessionIdRef.current
    if (!activeSessionId) {
      bufferRef.current = []
      return
    }
    if (bufferRef.current.length === 0) return

    const merged = [...pointsRef.current, ...bufferRef.current]
    bufferRef.current = []
    pointsRef.current = merged
    setLoaded({ sessionId: activeSessionId, points: merged, ready: true, error: null })
  }, [])

  /**
   * 每个真实读数都会同步走到这里。全程只写 ref 与 IndexedDB，
   * 不触发渲染（渲染由 flush 定时完成）。
   */
  const handlePosition = useCallback(
    (point: LiveGeoPoint) => {
      const activeSessionId = sessionIdRef.current
      if (!activeSessionId || !recordingRef.current) return

      /*
       * IP 粗略定位不进轨迹：它离你可能有几公里，画出来是一条根本不存在的路线。
       * 拿不到设备定位时轨迹就断着，宁可少一段，也不编一段。
       */
      if (point.source === 'ip') return

      const verdict = filterTrackPoint(point, lastKeptRef.current)
      if (!verdict.keep) return

      const trackPoint = toTrackPoint(activeSessionId, point)
      lastKeptRef.current = trackPoint
      bufferRef.current.push(trackPoint)

      // 先落库：每个点单独写入，刷新页面也不会丢
      putTrackPoint(trackPoint).catch((error) => {
        setLoaded((current) => ({ ...current, error: toIdbErrorMessage(error) }))
      })

      if (bufferRef.current.length >= FLUSH_BATCH) {
        flush()
        return
      }
      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flush, FLUSH_INTERVAL_MS)
      }
    },
    [flush],
  )

  const geo = useGeoWatcher({ onPosition: handlePosition })
  const { startWatch, pauseWatch, restartWatch, refresh, getLatest } = geo

  /**
   * 恢复已有轨迹：刷新页面、切走再回来都能接着记，
   * 过滤也从最后一个已保存的点继续，不会把接续的第一个点当成跳点。
   */
  useEffect(() => {
    // 换出勤时先把手上的东西放下，之前那场的数据已经逐个写进库了，不会丢
    pointsRef.current = []
    bufferRef.current = []
    lastKeptRef.current = null
    if (!sessionId) return

    let cancelled = false

    getTrackPoints(sessionId)
      .then((points) => {
        if (cancelled) return
        pointsRef.current = points
        lastKeptRef.current = points[points.length - 1] ?? null
        setLoaded({ sessionId, points, ready: true, error: null })
      })
      .catch((error) => {
        if (cancelled) return
        setLoaded({
          sessionId,
          points: [],
          ready: true,
          error: toIdbErrorMessage(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  /*
   * 监听器的开关：只有「有进行中的出勤 + 用户没有暂停」才监听。
   * 出勤结束（sessionId 变 null）时这里必然走到 pauseWatch，
   * 采点循环一定会被停掉，不会留在后台继续耗电。
   */
  useEffect(() => {
    if (!sessionId || !recording) {
      pauseWatch()
      return
    }
    startWatch()
  }, [sessionId, recording, startWatch, pauseWatch])

  // 卸载时清掉挂起的定时器（点已经在库里了，不会丢）
  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
    },
    [],
  )

  const start = useCallback(() => {
    const activeSessionId = sessionIdRef.current
    recordingRef.current = true
    setOverride(
      activeSessionId ? { sessionId: activeSessionId, recording: true } : null,
    )
    // 直接在用户手势里启动，权限弹窗更稳（重复调用会被内部挡掉）
    startWatch()
  }, [startWatch])

  const pause = useCallback(() => {
    const activeSessionId = sessionIdRef.current
    recordingRef.current = false
    setOverride(
      activeSessionId ? { sessionId: activeSessionId, recording: false } : null,
    )
    // 暂停前把还没进界面的点合并进去，暂停那一刻看到的数据才是完整的
    flush()
    pauseWatch()
  }, [pauseWatch, flush])

  const current = loaded.sessionId === sessionId ? loaded : null
  const points = useMemo(() => (current ? current.points : []), [current])
  const summary = useMemo(() => summarizeTrack(points), [points])

  return {
    sessionId,
    status: geo.status,
    error: geo.error,
    warning: geo.warning,
    backgrounded: geo.backgrounded,
    recording,
    latest: geo.position,
    points,
    summary,
    ready: current ? current.ready : false,
    storageError: sessionId === null ? null : (current?.error ?? null),
    start,
    pause,
    restart: restartWatch,
    refresh,
    getLatestPosition: getLatest,
  }
}

/* ------------------------- 只读：查看历史轨迹 ------------------------- */

export interface StoredTrackApi {
  points: TrackPoint[]
  summary: TrackSummary
  ready: boolean
  error: string | null
  reload: () => void
}

/** 从 IndexedDB 读某场出勤的轨迹（出勤详情、轨迹回放用），不启动任何定位 */
export function useStoredTrack(sessionId: string | null): StoredTrackApi {
  // 同样把「属于哪一场」一起存，sessionId 对不上就等于还没读好
  const [loaded, setLoaded] = useState<TrackLoad>({
    sessionId: '',
    points: [],
    ready: false,
    error: null,
  })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    getTrackPoints(sessionId)
      .then((points) => {
        if (cancelled) return
        setLoaded({ sessionId, points, ready: true, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        setLoaded({
          sessionId,
          points: [],
          ready: true,
          error: toIdbErrorMessage(err),
        })
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, reloadKey])

  const current = loaded.sessionId === sessionId ? loaded : null
  const points = useMemo(() => (current ? current.points : []), [current])
  const summary = useMemo(() => summarizeTrack(points), [points])
  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  return {
    points,
    summary,
    ready: current ? current.ready : false,
    error: sessionId === null ? null : (current?.error ?? null),
    reload,
  }
}
