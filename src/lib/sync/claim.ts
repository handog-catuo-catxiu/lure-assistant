/**
 * 首次登录时把「没有归属账号」的本机旧数据显式导入当前账号。
 *
 * 设计原则：
 * - 只有用户主动点击才会执行，登录本身绝不自动上传
 * - 旧数据只读不删：导入是复制，旧 localStorage / IndexedDB 原样保留
 * - 同一份数据可以被重复执行（幂等）：已存在的 id 不覆盖，不会重复上传
 * - 先写本机账号范围，再写认领标记；即使之后云端同步失败，数据也已在账号下，可重试
 * - 已被其它 uid 认领过的本机数据，当前账号不能再次认领
 */
import type { CatchRecord, Spot, TrackPoint, TripSession } from '../../types/trip'
import type { GearItem } from '../../types/gear'
import {
  activeScope,
  activeUid,
  databaseNameForScope,
  readClaim,
  writeClaim,
} from './scope'
import { markDirty, setTrackSynced } from './meta'
import {
  loadGearRaw,
  loadLegacyGear,
  writeGearRaw,
} from '../gearStorage'
import {
  loadCatchesRaw,
  loadLegacyCatches,
  loadLegacySpots,
  loadLegacyTrips,
  loadSpotsRaw,
  loadTripsRaw,
  writeCatchesRaw,
  writeSpotsRaw,
  writeTripsRaw,
} from '../tripStorage'
import {
  copyCatchPhotoRecord,
  copyImageRecord,
  getAllCatchPhotos,
  getAllImages,
  getCatchPhoto,
  getImage,
} from '../imageStore'
import {
  getAllTrackPoints,
  putTrackPoints,
} from '../trackStore'
import { importLegacyPrefs, loadLegacyPrefs } from '../prefs'
import { emitRemoteApplied } from './events'

export interface LegacySummary {
  gear: number
  spot: number
  trip: number
  catch: number
  pref: number
  gearImage: number
  catchImage: number
  track: number
  total: number
}

export interface ClaimCounts extends LegacySummary {
  /** 实际新并入当前账号的数量；重复执行时为 0 */
  added: {
    gear: number
    spot: number
    trip: number
    catch: number
    pref: number
    gearImage: number
    catchImage: number
    track: number
  }
}

export type ClaimOutcome =
  | { ok: true; counts: ClaimCounts }
  | { ok: false; error: string }

const LEGACY_DB = 'luremate'

function totalOf(
  values: Omit<LegacySummary, 'total'>,
): number {
  return (
    values.gear +
    values.spot +
    values.trip +
    values.catch +
    values.pref +
    values.gearImage +
    values.catchImage +
    values.track
  )
}

/** 只读统计本机旧数据，不打开写事务、不修改任何东西 */
export async function summarizeLegacy(): Promise<LegacySummary> {
  const gear = loadLegacyGear().length
  const spot = loadLegacySpots().length
  const trip = loadLegacyTrips().length
  const catchCount = loadLegacyCatches().length

  const prefs = loadLegacyPrefs()
  const pref =
    (prefs.homeRefSpot !== null ? 1 : 0) +
    (prefs.homeWater !== 'unknown' ? 1 : 0)

  let gearImage = 0
  let catchImage = 0
  let track = 0
  try {
    gearImage = (await getAllImages('original', LEGACY_DB)).length
    catchImage = (await getAllCatchPhotos('original', LEGACY_DB)).length
    track = (await getAllTrackPoints(LEGACY_DB)).length
  } catch {
    // 浏览器不支持 IndexedDB 时只统计 localStorage 部分
  }

  const counts = {
    gear,
    spot,
    trip,
    catch: catchCount,
    pref,
    gearImage,
    catchImage,
    track,
  }
  return { ...counts, total: totalOf(counts) }
}

function mergeById<T extends { id: string }>(
  current: T[],
  legacy: T[],
): { merged: T[]; added: T[] } {
  const existing = new Set(current.map((item) => item.id))
  const added = legacy.filter((item) => !existing.has(item.id))
  return { merged: [...current, ...added], added }
}

/**
 * 把本机旧数据复制到当前账号范围。
 *
 * 不删除旧数据；不覆盖当前账号里已经存在的同 id 记录；
 * 只把真正新增的记录标成待上传，避免重复上传。
 */
export async function claimLegacyData(uid: string): Promise<ClaimOutcome> {
  if (activeUid() !== uid) {
    return { ok: false, error: '登录状态已经变化，请刷新页面后重试' }
  }

  const existingClaim = readClaim()
  if (existingClaim && existingClaim.uid !== uid) {
    return { ok: false, error: '这份本机数据已属于另一个账号，不能导入当前账号' }
  }

  const summary = await summarizeLegacy()
  if (summary.total === 0) {
    return { ok: false, error: '没有找到需要导入的本机数据' }
  }

  // 1. 结构化数据：按 id 合并，当前账号已有的记录优先
  const gearMerge = mergeById(loadGearRaw(activeScope()), loadLegacyGear())
  const spotMerge = mergeById(loadSpotsRaw(activeScope()), loadLegacySpots())
  const tripMerge = mergeById(loadTripsRaw(activeScope()), loadLegacyTrips())
  const catchMerge = mergeById(loadCatchesRaw(activeScope()), loadLegacyCatches())

  const gearOk = gearMerge.added.length === 0 || writeGearRaw(gearMerge.merged)
  const spotOk = spotMerge.added.length === 0 || writeSpotsRaw(spotMerge.merged)
  const tripOk = tripMerge.added.length === 0 || writeTripsRaw(tripMerge.merged)
  const catchOk =
    catchMerge.added.length === 0 || writeCatchesRaw(catchMerge.merged)

  if (!gearOk || !spotOk || !tripOk || !catchOk) {
    return {
      ok: false,
      error: '本机存储空间不足，导入没有完成。旧数据仍然保留，清理空间后可以重试',
    }
  }

  const now = Date.now()
  for (const item of gearMerge.added) markDirty('gear', item.id, now)
  for (const item of spotMerge.added) markDirty('spot', item.id, now)
  for (const item of tripMerge.added) markDirty('trip', item.id, now)
  for (const item of catchMerge.added) markDirty('catch', item.id, now)

  // 2. 偏好：合并两个首页选择；已经改过的项不会被旧值覆盖
  const addedPref = importLegacyPrefs()

  // 3. 图片：只复制新记录，已存在的账号图片不动
  const accountDb = databaseNameForScope(activeScope())
  const gearIds = new Set(gearMerge.merged.map((item) => item.id))
  const catchIds = new Set(catchMerge.merged.map((item) => item.id))

  let addedGearImage = 0
  let partialFailure = false
  try {
    const legacyGearImages = await getAllImages('original', LEGACY_DB)
    for (const record of legacyGearImages) {
      if (!gearIds.has(record.gearId)) continue
      const current = await getImage(record.gearId, 'original', accountDb)
      if (current) continue
      await copyImageRecord(record, accountDb)
      markDirty('gearImage', record.gearId, record.updatedAt)
      addedGearImage += 1
    }
  } catch {
    // 图片复制失败不影响文字数据；但不写认领标记，让用户可以重试
    partialFailure = true
  }

  let addedCatchImage = 0
  try {
    const legacyCatchPhotos = await getAllCatchPhotos('original', LEGACY_DB)
    for (const record of legacyCatchPhotos) {
      if (!catchIds.has(record.catchId)) continue
      const current = await getCatchPhoto(record.catchId, 'original', accountDb)
      if (current) continue
      await copyCatchPhotoRecord(record, accountDb)
      markDirty('catchImage', record.catchId, record.updatedAt)
      addedCatchImage += 1
    }
  } catch {
    partialFailure = true
  }

  // 4. 轨迹点：只复制缺失的点；把对应出勤的上传进度归零，
  //    让同步引擎把本地全部点重新 upsert 一遍（按 id 幂等，不会重复）
  let addedTrack = 0
  const touchedSessions = new Set<string>()
  try {
    const sessionIds = new Set(tripMerge.merged.map((item) => item.id))
    const currentPoints = await getAllTrackPoints(accountDb)
    const currentIds = new Set(currentPoints.map((point) => point.id))
    const legacyPoints: TrackPoint[] = (await getAllTrackPoints(LEGACY_DB)).filter(
      (point) => sessionIds.has(point.sessionId) && !currentIds.has(point.id),
    )
    if (legacyPoints.length > 0) {
      await putTrackPoints(legacyPoints)
      for (const point of legacyPoints) touchedSessions.add(point.sessionId)
      for (const sessionId of touchedSessions) setTrackSynced(sessionId, 0)
      addedTrack = legacyPoints.length
    }
  } catch {
    // 轨迹复制失败不阻塞结构化数据导入，但保留重试入口
    partialFailure = true
  }

  const counts: ClaimCounts = {
    ...summary,
    added: {
      gear: gearMerge.added.length,
      spot: spotMerge.added.length,
      trip: tripMerge.added.length,
      catch: catchMerge.added.length,
      pref: addedPref,
      gearImage: addedGearImage,
      catchImage: addedCatchImage,
      track: addedTrack,
    },
  }

  // 数据已经写进当前账号范围，通知界面重新读取；不需要刷新页面
  emitRemoteApplied('gear')
  emitRemoteApplied('spot')
  emitRemoteApplied('trip')
  emitRemoteApplied('catch')
  emitRemoteApplied('pref')
  emitRemoteApplied('image')
  emitRemoteApplied('track')

  /*
   * 文字记录已经合并成功，但照片或轨迹没复制完：
   * 先不写认领标记，界面会保留「导入」入口。再次导入按 id 合并，
   * 不会重复文字记录，只会补上缺失的照片/轨迹。
   */
  if (partialFailure) {
    return {
      ok: false,
      error:
        '文字记录已导入当前账号，但部分照片或轨迹没有复制完成。旧数据仍在本机，请稍后重试导入。',
    }
  }

  // 最后才写认领标记：即使中途失败，下次还能继续；旧数据始终不动
  // 标记里只存数字；added 记录本次真正新增的数量，total 记录旧数据总量
  writeClaim(uid, {
    gear: counts.added.gear,
    spot: counts.added.spot,
    trip: counts.added.trip,
    catch: counts.added.catch,
    pref: counts.added.pref,
    gearImage: counts.added.gearImage,
    catchImage: counts.added.catchImage,
    track: counts.added.track,
    total: summary.total,
  })

  return { ok: true, counts }
}

/** 诊断用：当前账号库里已有哪些本地 id（只读） */
export function localAccountIds(): {
  gear: string[]
  spot: string[]
  trip: string[]
  catch: string[]
} {
  return {
    gear: loadGearRaw(activeScope()).map((item: GearItem) => item.id),
    spot: loadSpotsRaw(activeScope()).map((item: Spot) => item.id),
    trip: loadTripsRaw(activeScope()).map((item: TripSession) => item.id),
    catch: loadCatchesRaw(activeScope()).map((item: CatchRecord) => item.id),
  }
}
