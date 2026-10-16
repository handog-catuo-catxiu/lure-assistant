import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CatchRecord, TrackPoint } from '../types/trip'

/**
 * 轨迹回放：把一场出勤的 GPS 轨迹按时间顺序放一遍。
 *
 * - 只回放**已经保存的真实轨迹点**，播放过程不会去请求定位
 * - 播放头按真实时间轴推进，所以渔获会在「大约上鱼的那个时刻」出现
 * - 长出勤按倍数压缩播放（默认 60 倍速），保证几十秒内能看完
 * - 时长很短或很长的轨迹都会被夹到 6–45 秒，避免一闪而过或等到睡着
 */

/** 默认播放倍速 */
const DEFAULT_SPEED = 60
const MIN_PLAYBACK_MS = 6_000
const MAX_PLAYBACK_MS = 45_000

/** 画面刷新间隔：25fps 已经足够顺，再密只是白烧电 */
const PUBLISH_INTERVAL_MS = 40

export interface TrackPlaybackApi {
  /** 轨迹够不够放 */
  canPlay: boolean
  playing: boolean
  finished: boolean
  /** 0–1 */
  progress: number
  /** 播放头对应的真实时间戳；没有轨迹时 null */
  currentTime: number | null
  /** 播放头的真实位置 */
  head: TrackPoint | null
  /** 到播放头为止的轨迹点（地图画线用） */
  visiblePoints: TrackPoint[]
  /** 到播放头为止、并且有坐标的渔获 */
  visibleCatches: CatchRecord[]
  /** 真实轨迹时间跨度 */
  durationMs: number
  /** 压缩后的播放时长 */
  playbackMs: number
  speed: number
  play: () => void
  pause: () => void
  restart: () => void
  seek: (progress: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 找到最后一个「采集时间不晚于 time」的点的下标，找不到返回 -1 */
function indexAtTime(points: TrackPoint[], time: number): number {
  let low = 0
  let high = points.length - 1
  let found = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (points[mid].recordedAt <= time) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

export function useTrackPlayback(
  points: TrackPoint[],
  catches: CatchRecord[],
): TrackPlaybackApi {
  const startAt = points.length > 0 ? points[0].recordedAt : null
  const endAt = points.length > 1 ? points[points.length - 1].recordedAt : null
  const durationMs = startAt !== null && endAt !== null ? endAt - startAt : 0

  const canPlay = points.length >= 2 && durationMs > 0

  const playbackMs = useMemo(() => {
    if (!canPlay) return 0
    return clamp(durationMs / DEFAULT_SPEED, MIN_PLAYBACK_MS, MAX_PLAYBACK_MS)
  }, [canPlay, durationMs])

  const [elapsedMs, setElapsedMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [finished, setFinished] = useState(false)

  // RAF 里累加用，避免每帧都去读 state
  const elapsedRef = useRef(0)
  const frameRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const lastPublishAtRef = useRef(0)

  const stopFrame = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [])

  // 卸载时停掉动画帧；换一场出勤由调用方用 key 重新挂载这个 hook
  useEffect(() => stopFrame, [stopFrame])

  /** 造一个自走的动画帧循环。写成局部函数，循环里能安全地引用它自己 */
  const makeLoop = useCallback(() => {
    const loop = (timestamp: number) => {
      const last = lastFrameAtRef.current || timestamp
      lastFrameAtRef.current = timestamp
      const delta = timestamp - last

      elapsedRef.current = Math.min(playbackMs, elapsedRef.current + delta)

      // 每帧都 setState 没必要，按 25fps 发布
      if (timestamp - lastPublishAtRef.current >= PUBLISH_INTERVAL_MS) {
        lastPublishAtRef.current = timestamp
        setElapsedMs(elapsedRef.current)
      }

      if (elapsedRef.current >= playbackMs) {
        setElapsedMs(playbackMs)
        setPlaying(false)
        setFinished(true)
        frameRef.current = 0
        return
      }
      frameRef.current = requestAnimationFrame(loop)
    }

    return loop
  }, [playbackMs])

  const play = useCallback(() => {
    if (!canPlay || playing) return
    // 放完了再点播放 = 从头重放
    if (finished || elapsedRef.current >= playbackMs) {
      elapsedRef.current = 0
      setElapsedMs(0)
      setFinished(false)
    }
    lastFrameAtRef.current = 0
    lastPublishAtRef.current = 0
    setPlaying(true)
    frameRef.current = requestAnimationFrame(makeLoop())
  }, [canPlay, finished, makeLoop, playbackMs, playing])

  const pause = useCallback(() => {
    stopFrame()
    setPlaying(false)
  }, [stopFrame])

  const restart = useCallback(() => {
    stopFrame()
    elapsedRef.current = 0
    setElapsedMs(0)
    setFinished(false)
    setPlaying(canPlay)
    if (canPlay) {
      lastFrameAtRef.current = 0
      lastPublishAtRef.current = 0
      frameRef.current = requestAnimationFrame(makeLoop())
    }
  }, [canPlay, makeLoop, stopFrame])

  const seek = useCallback(
    (progress: number) => {
      if (!canPlay) return
      const next = clamp(progress, 0, 1) * playbackMs
      stopFrame()
      elapsedRef.current = next
      setElapsedMs(next)
      setPlaying(false)
      // 拖到最后就是「已放完」，再点播放会从头开始
      setFinished(next >= playbackMs)
    },
    [canPlay, playbackMs, stopFrame],
  )

  const progress = playbackMs > 0 ? clamp(elapsedMs / playbackMs, 0, 1) : 0
  const currentTime =
    startAt !== null && durationMs > 0 ? startAt + durationMs * progress : startAt

  const visiblePoints = useMemo(() => {
    if (currentTime === null) return []
    const index = indexAtTime(points, currentTime)
    return index < 0 ? [] : points.slice(0, index + 1)
  }, [points, currentTime])

  const visibleCatches = useMemo(() => {
    if (currentTime === null) return []
    return catches.filter(
      (record) =>
        typeof record.latitude === 'number' &&
        typeof record.longitude === 'number' &&
        record.caughtAt <= currentTime,
    )
  }, [catches, currentTime])

  const head =
    visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1] : null

  return {
    canPlay,
    playing,
    finished,
    progress,
    currentTime,
    head,
    visiblePoints,
    visibleCatches,
    durationMs,
    playbackMs,
    speed: DEFAULT_SPEED,
    play,
    pause,
    restart,
    seek,
  }
}
