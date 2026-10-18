import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyCatchDraft,
  applySpotDraft,
  catchesOfSession,
  changeSessionGear,
  createCatch,
  createSpot,
  createTripSession,
  endTripSession,
  findActiveSession,
  sortSessionsByStartDesc,
} from '../lib/tripService'
import {
  loadCatches,
  loadSpots,
  loadTrips,
  saveCatches,
  saveSpots,
  saveTrips,
} from '../lib/tripStorage'
import { subscribeRemoteApplied } from '../lib/sync/events'
import type {
  CatchDraft,
  CatchRecord,
  GeoPoint,
  Spot,
  SpotDraft,
  TripResult,
  TripSession,
} from '../types/trip'

/** 存储写入失败的统一提示 */
const SAVE_ERROR = '保存失败，可能是浏览器本地存储空间不足'

/**
 * 出勤数据的唯一入口：标点、出勤、渔获三份数据都在这里管理，
 * 业务规则委托给 lib/tripService，持久化委托给 lib/tripStorage，
 * 页面只跟这个 hook 打交道。
 *
 * 只有真的发生改动才写 localStorage，所以即使读到损坏的数据也不会被冲掉。
 */
export function useTrip() {
  const [spots, setSpots] = useState<Spot[]>(loadSpots)
  const [sessions, setSessions] = useState<TripSession[]>(loadTrips)
  const [catches, setCatches] = useState<CatchRecord[]>(loadCatches)

  /*
   * state 的同步镜像。业务操作必须立刻读到最后一次写入的结果：
   * setState 不是同步可见的，连点两下「开始出勤」时第二次读到的还是旧数组，
   * 就会漏掉「同一时间只能有一场进行中的出勤」这条判断。
   */
  const spotsRef = useRef(spots)
  const sessionsRef = useRef(sessions)
  const catchesRef = useRef(catches)

  // 云端合并完成后重新读取，正在填写中的表单不受影响（表单状态在弹窗组件里）
  useEffect(
    () =>
      subscribeRemoteApplied((kind) => {
        if (kind === 'spot') {
          const next = loadSpots()
          spotsRef.current = next
          setSpots(next)
        } else if (kind === 'trip') {
          const next = loadTrips()
          sessionsRef.current = next
          setSessions(next)
        } else if (kind === 'catch') {
          const next = loadCatches()
          catchesRef.current = next
          setCatches(next)
        }
      }),
    [],
  )

  /** 先落库再更新界面：写失败就保持原样，由调用方提示用户 */
  const commitSpots = useCallback((next: Spot[]) => {
    if (!saveSpots(next)) return false
    spotsRef.current = next
    setSpots(next)
    return true
  }, [])

  const commitSessions = useCallback((next: TripSession[]) => {
    if (!saveTrips(next)) return false
    sessionsRef.current = next
    setSessions(next)
    return true
  }, [])

  const commitCatches = useCallback((next: CatchRecord[]) => {
    if (!saveCatches(next)) return false
    catchesRef.current = next
    setCatches(next)
    return true
  }, [])

  /* --------------------------------- 标点 --------------------------------- */

  const addSpot = useCallback(
    (draft: SpotDraft): TripResult<Spot> => {
      const name = draft.name.trim()
      if (!name) return { ok: false, error: '请先填写标点名称' }

      const spot = createSpot({ ...draft, name, note: draft.note.trim() })
      // 新建的排在最前，方便刚建完就看到
      if (!commitSpots([spot, ...spotsRef.current])) {
        return { ok: false, error: SAVE_ERROR }
      }
      return { ok: true, value: spot }
    },
    [commitSpots],
  )

  const updateSpot = useCallback(
    (id: string, draft: SpotDraft): TripResult => {
      const name = draft.name.trim()
      if (!name) return { ok: false, error: '请先填写标点名称' }

      const target = spotsRef.current.find((spot) => spot.id === id)
      if (!target) return { ok: false, error: '标点不存在，可能已经被删除' }

      const trimmed: SpotDraft = { ...draft, name, note: draft.note.trim() }
      const next = spotsRef.current.map((spot) =>
        spot.id === id ? applySpotDraft(spot, trimmed) : spot,
      )
      if (!commitSpots(next)) return { ok: false, error: SAVE_ERROR }
      return { ok: true, value: null }
    },
    [commitSpots],
  )

  /**
   * 删除标点。出勤里存了标点名快照，所以历史记录不会因为标点消失而看不出来，
   * 这里不需要连带处理出勤数据。
   */
  const removeSpot = useCallback(
    (id: string): TripResult => {
      const next = spotsRef.current.filter((spot) => spot.id !== id)
      if (!commitSpots(next)) return { ok: false, error: SAVE_ERROR }
      return { ok: true, value: null }
    },
    [commitSpots],
  )

  /* --------------------------------- 出勤 --------------------------------- */

  const startTrip = useCallback(
    (input: { spotId: string; gearIds: string[] }): TripResult<TripSession> => {
      if (findActiveSession(sessionsRef.current)) {
        return { ok: false, error: '已经有一场进行中的出勤了' }
      }

      const spot = spotsRef.current.find((item) => item.id === input.spotId)
      if (!spot) return { ok: false, error: '找不到这个标点，请重新选择' }

      const session = createTripSession({
        spotId: spot.id,
        spotName: spot.name,
        gearIds: input.gearIds,
      })
      if (!commitSessions([session, ...sessionsRef.current])) {
        return { ok: false, error: SAVE_ERROR }
      }
      return { ok: true, value: session }
    },
    [commitSessions],
  )

  /** 出勤途中增删本次携带的装备 */
  const setTripGear = useCallback(
    (sessionId: string, gearIds: string[]): TripResult<TripSession> => {
      const session = sessionsRef.current.find((item) => item.id === sessionId)
      if (!session) return { ok: false, error: '找不到这场出勤' }
      if (session.status !== 'active') {
        return { ok: false, error: '这场出勤已经结束，不能再改装备了' }
      }

      const next = changeSessionGear(session, gearIds)
      if (
        !commitSessions(
          sessionsRef.current.map((item) => (item.id === sessionId ? next : item)),
        )
      ) {
        return { ok: false, error: SAVE_ERROR }
      }
      return { ok: true, value: next }
    },
    [commitSessions],
  )

  /**
   * 一键上鱼：立刻写一条渔获并持久化，不需要用户先填任何东西。
   * 返回新建的记录，界面拿到后就可以打开「完善渔获」。
   *
   * location 是可选的当前定位读数：有就拿上，没有也照记不误，
   * 绝不为等定位而延迟这次保存。
   */
  const addCatchNow = useCallback(
    (sessionId: string, location: GeoPoint | null = null): TripResult<CatchRecord> => {
      const session = sessionsRef.current.find((item) => item.id === sessionId)
      if (!session) return { ok: false, error: '找不到这场出勤' }
      if (session.status !== 'active') {
        return { ok: false, error: '这场出勤已经结束，不能再上鱼了' }
      }

      const record = createCatch(session, location)
      if (!commitCatches([record, ...catchesRef.current])) {
        return { ok: false, error: SAVE_ERROR }
      }
      return { ok: true, value: record }
    },
    [commitCatches],
  )

  const endTrip = useCallback(
    (sessionId: string): TripResult<TripSession> => {
      const session = sessionsRef.current.find((item) => item.id === sessionId)
      if (!session) return { ok: false, error: '找不到这场出勤' }
      if (session.status !== 'active') {
        return { ok: false, error: '这场出勤已经结束了' }
      }

      const next = endTripSession(session)
      if (
        !commitSessions(
          sessionsRef.current.map((item) => (item.id === sessionId ? next : item)),
        )
      ) {
        return { ok: false, error: SAVE_ERROR }
      }
      return { ok: true, value: next }
    },
    [commitSessions],
  )

  /* --------------------------------- 渔获 --------------------------------- */

  const updateCatch = useCallback(
    (id: string, draft: CatchDraft): TripResult<CatchRecord> => {
      const target = catchesRef.current.find((record) => record.id === id)
      if (!target) return { ok: false, error: '找不到这条渔获' }

      const next = applyCatchDraft(target, draft)
      if (
        !commitCatches(
          catchesRef.current.map((record) => (record.id === id ? next : record)),
        )
      ) {
        return { ok: false, error: SAVE_ERROR }
      }
      return { ok: true, value: next }
    },
    [commitCatches],
  )

  const removeCatch = useCallback(
    (id: string): TripResult => {
      const next = catchesRef.current.filter((record) => record.id !== id)
      if (!commitCatches(next)) return { ok: false, error: SAVE_ERROR }
      return { ok: true, value: null }
    },
    [commitCatches],
  )

  /* --------------------------------- 查询 --------------------------------- */

  const activeSession = useMemo(() => findActiveSession(sessions), [sessions])
  const historySessions = useMemo(() => sortSessionsByStartDesc(sessions), [sessions])

  const sessionById = useCallback(
    (id: string) => sessions.find((session) => session.id === id) ?? null,
    [sessions],
  )

  const spotById = useCallback(
    (id: string) => spots.find((spot) => spot.id === id) ?? null,
    [spots],
  )

  const catchesOf = useCallback(
    (sessionId: string) => catchesOfSession(catches, sessionId),
    [catches],
  )

  const catchCountOf = useCallback(
    (sessionId: string) =>
      catches.reduce(
        (total, record) => (record.sessionId === sessionId ? total + 1 : total),
        0,
      ),
    [catches],
  )

  /** 某个标点被多少场出勤用过（删除标点前提示用） */
  const tripCountOfSpot = useCallback(
    (spotId: string) =>
      sessions.reduce(
        (total, session) => (session.spotId === spotId ? total + 1 : total),
        0,
      ),
    [sessions],
  )

  return {
    spots,
    sessions,
    catches,
    activeSession,
    historySessions,
    addSpot,
    updateSpot,
    removeSpot,
    startTrip,
    setTripGear,
    addCatchNow,
    endTrip,
    updateCatch,
    removeCatch,
    sessionById,
    spotById,
    catchesOf,
    catchCountOf,
    tripCountOfSpot,
  }
}

export type TripApi = ReturnType<typeof useTrip>
