/**
 * 个人数据双向同步引擎。
 *
 * 数据分层：
 * - 本地仍然是原来的 localStorage / IndexedDB 结构，离线照常使用
 * - 云端 PostgreSQL 只存结构化字段和图片的对象路径，图片本体在对象存储
 * - 同步元数据（sync/meta.ts）记录待上传项、墓碑和增量游标
 *
 * 同步一轮的顺序：
 * 1. 上传照片 → 2. 上传结构化数据（标点 / 出勤 / 渔获 / 装备 / 偏好 / 轨迹）
 * → 3. 按 updated_at 游标增量拉取远端 → 4. 合并到本地
 *
 * 冲突规则：最后写入优先（LWW），比较双方最后修改时间；
 * 本地有未上传修改且更新的记录不会被远端旧数据覆盖。
 * 删除使用墓碑（deleted_at），删除也会同步到其它设备。
 *
 * 所有读写都依赖服务端 RLS；引擎不发送、也不信任客户端自造的 user_id，
 * 行里的 user_id 由数据库默认 auth.uid() 或当前会话决定。
 */
import type { GearItem } from '../../types/gear'
import type { CatchRecord, Spot, TrackPoint, TripSession } from '../../types/trip'
import {
  activeScope,
  activeUid,
  getDeviceId,
  readClaim,
} from './scope'
import {
  applyRemoteMeta,
  forgetRecord,
  getCursor,
  getRecordMeta,
  getTrackSynced,
  loadMeta,
  markClean,
  markDirty,
  pendingCount,
  pendingRecords,
  setCursor,
  setLastSyncedAt,
  setTrackSynced,
} from './meta'
import { subscribeLocalChanges } from './events'
import {
  applyGearFromRemote,
  loadGearRaw,
} from '../gearStorage'
import {
  applyCatchesFromRemote,
  applySpotsFromRemote,
  applyTripsFromRemote,
  loadCatchesRaw,
  loadSpotsRaw,
  loadTripsRaw,
} from '../tripStorage'
import {
  deleteCatchPhotoFromRemote,
  deleteImageFromRemote,
  getCatchPhoto,
  getImage,
  putCatchPhotoFromRemote,
  putImageFromRemote,
} from '../imageStore'
import {
  deleteTrackPoints,
  getTrackPoints,
  putTrackPointsFromRemote,
} from '../trackStore'
import {
  applyPrefsFromRemote,
  pendingPrefRows,
  type PrefRow,
} from '../prefs'
import {
  CloudApiError,
  cloudErrorMessage,
  getRdb,
  getStorage,
  isCloudDataConfigured,
  isOffline,
  userMediaBucket,
} from '../cloud/client'
import {
  buildCatchRow,
  buildGearRow,
  buildSpotRow,
  buildTripRow,
  mapCatchRow,
  mapGearRow,
  mapSpotRow,
  mapTrackRow,
  mapTripRow,
  remoteDeleted,
  serverTime,
  tombstonePatch,
  type RemoteRecord,
  type UserCatchRow,
  type UserGearRow,
  type UserImageRow,
  type UserPrefRow,
  type UserSpotRow,
  type UserTrackRow,
  type UserTripRow,
} from '../cloud/userData'
import { summarizeLegacy, claimLegacyData, type LegacySummary } from './claim'

export type SyncPhase =
  | 'signedOut'
  | 'local'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'error'

export interface SyncSnapshot {
  phase: SyncPhase
  /** 当前登录账号的 uid；未登录时为 null */
  uid: string | null
  /** 待上传的记录数（不含轨迹点批次） */
  pending: number
  lastSyncedAt: number | null
  /** 可以直接展示的中文错误 */
  error: string | null
  /** 本机旧数据还没有归属账号，需要用户明确点「导入」 */
  claimRequired: boolean
  claimSummary: LegacySummary | null
  claiming: boolean
}

export interface ClaimResult {
  ok: boolean
  error?: string
}

const PAGE_SIZE = 200
const MAX_PULL_PAGES = 20
const TRACK_BATCH = 400
const MAX_TRACK_BATCHES = 10
const DEBOUNCE_MS = 1500
const RETRY_DELAYS = [5000, 15000, 60000, 300000]

class Engine {
  private uid: string | null = null
  private snapshot: SyncSnapshot = {
    phase: 'signedOut',
    uid: null,
    pending: 0,
    lastSyncedAt: null,
    error: null,
    claimRequired: false,
    claimSummary: null,
    claiming: false,
  }

  private listeners = new Set<(snapshot: SyncSnapshot) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private repeat: ReturnType<typeof setInterval> | null = null
  private unsubscribe: (() => void) | null = null
  private running: Promise<void> | null = null
  private rerun = false
  private retryIndex = 0
  private stopped = true
  private onlineHandler: (() => void) | null = null
  private visibilityHandler: (() => void) | null = null

  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot
  }

  private emit(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  start(uid: string): void {
    if (this.uid === uid && !this.stopped) return
    this.stop()
    this.uid = uid
    this.stopped = false
    this.retryIndex = 0

    this.emit({
      // 没配置 Publishable Key 时只做本机存储，不显示成「同步中」
      phase: isCloudDataConfigured() ? 'syncing' : 'local',
      uid,
      pending: pendingCount(),
      lastSyncedAt: loadMeta().lastSyncedAt,
      error: null,
      claimRequired: false,
      claimSummary: null,
      claiming: false,
    })

    this.unsubscribe = subscribeLocalChanges((kind) => {
      // 元数据本身的变化不用再触发一轮请求，真正改数据的 kind 会另外通知
      this.emit({ pending: pendingCount() })
      if (kind === 'meta' || kind === 'pref') {
        if (kind === 'pref') this.schedule(DEBOUNCE_MS)
        return
      }
      this.schedule(DEBOUNCE_MS)
    })

    this.onlineHandler = () => {
      this.emit({ error: null })
      this.schedule(0)
    }
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') this.schedule(300)
    }
    window.addEventListener('online', this.onlineHandler)
    document.addEventListener('visibilitychange', this.visibilityHandler)

    // 多设备同步：前台每分钟增量拉一次
    this.repeat = setInterval(() => this.schedule(0), 60_000)

    void this.refreshClaim().finally(() => this.schedule(0))
  }

  stop(): void {
    this.stopped = true
    this.uid = null
    this.clearTimers()
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler)
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
    }
    this.onlineHandler = null
    this.visibilityHandler = null
    this.running = null
    this.rerun = false
    this.emit({
      phase: 'signedOut',
      uid: null,
      pending: 0,
      error: null,
      claimRequired: false,
      claimSummary: null,
      claiming: false,
    })
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.repeat) clearInterval(this.repeat)
    this.timer = null
    this.repeat = null
  }

  private schedule(delay: number): void {
    if (this.stopped || !this.uid) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.syncNow()
    }, delay)
  }

  async syncNow(): Promise<void> {
    const uid = this.uid
    if (!uid || this.stopped) return
    if (this.running) {
      this.rerun = true
      return this.running
    }

    this.running = this.runCycle(uid).finally(() => {
      this.running = null
      if (this.rerun) {
        this.rerun = false
        this.schedule(DEBOUNCE_MS)
      }
    })
    return this.running
  }

  private async runCycle(uid: string): Promise<void> {
    // 云端数据库/存储还没配置：如实停在本机模式，不发必然失败的请求
    if (!isCloudDataConfigured()) {
      this.emit({
        phase: 'local',
        pending: pendingCount(),
        error: null,
      })
      return
    }

    if (isOffline()) {
      this.emit({
        phase: 'offline',
        pending: pendingCount(),
        error: '网络不可用，记录已保存在本机，等待同步。',
      })
      return
    }

    this.emit({ phase: 'syncing', error: null, pending: pendingCount() })

    try {
      await this.pushAll(uid)
      await this.pullAll(uid)

      if (this.uid !== uid || this.stopped) return

      setLastSyncedAt()
      this.retryIndex = 0
      this.emit({
        phase: 'synced',
        pending: pendingCount(),
        lastSyncedAt: Date.now(),
        error: null,
      })
    } catch (error) {
      if (this.uid !== uid || this.stopped) return

      const offline = isOffline()
      const message = offline
        ? '网络不可用，记录已保存在本机，等待同步。'
        : cloudErrorMessage(error)
      this.emit({
        phase: offline ? 'offline' : 'error',
        pending: pendingCount(),
        error: message,
      })

      if (!offline) {
        const delay = RETRY_DELAYS[Math.min(this.retryIndex, RETRY_DELAYS.length - 1)]
        this.retryIndex += 1
        this.schedule(delay)
      }
    }
  }

  async refreshClaim(): Promise<void> {
    const uid = activeUid()
    if (!uid) return
    const claim = readClaim()

    // 已被本账号认领过就不再提示；被别的账号认领过也绝不能再次导入
    if (claim !== null) {
      this.emit({ claimRequired: false, claimSummary: null })
      return
    }

    // 未配置云端时也可只看本机数据，这里只统计，不改任何数据
    const summary = await summarizeLegacy()
    if (this.uid !== uid || this.stopped) return
    this.emit({
      claimRequired: summary.total > 0,
      claimSummary: summary.total > 0 ? summary : null,
    })
  }

  async claimLocalData(): Promise<ClaimResult> {
    const uid = this.uid
    if (!uid) return { ok: false, error: '请先登录后再导入本机数据' }
    if (this.snapshot.claiming) return { ok: false, error: '正在导入，请稍候' }

    this.emit({ claiming: true })
    try {
      const result = await claimLegacyData(uid)
      if (!result.ok) {
        this.emit({ claiming: false, error: result.error })
        return { ok: false, error: result.error }
      }
      this.emit({
        claiming: false,
        claimRequired: false,
        claimSummary: null,
        pending: pendingCount(),
        error: null,
      })
      this.schedule(0)
      return { ok: true }
    } catch (error) {
      const message = cloudErrorMessage(error)
      this.emit({ claiming: false, error: message })
      return { ok: false, error: message }
    }
  }

  /* ------------------------------- 上传 ------------------------------- */

  private async pushAll(uid: string): Promise<void> {
    const deviceId = getDeviceId()
    await this.pushGearImages(uid, deviceId)
    await this.pushCatchImages(uid, deviceId)
    await this.pushSpots(uid, deviceId)
    await this.pushTrips(uid, deviceId)
    await this.pushCatches(uid, deviceId)
    await this.pushGears(uid, deviceId)
    await this.pushPrefs(uid, deviceId)
    await this.pushTracks(uid)
  }

  private assertUid(uid: string): void {
    if (this.uid !== uid || this.stopped) {
      throw new Error('SYNC_ABORTED')
    }
  }

  private async pushGearImages(uid: string, deviceId: string): Promise<void> {
    const pending = pendingRecords('gearImage')
    if (pending.length === 0) return

    const gears = new Map(loadGearRaw(activeScope()).map((item) => [item.id, item]))
    for (const { id, meta } of pending) {
      this.assertUid(uid)
      const gear = gears.get(id)
      const path = gearImagePath(uid, id)

      if (!gear || meta.deletedAt !== null) {
        /*
         * 先写数据库墓碑，确认这次删除真的生效后再删对象文件。
         * 如果另一台设备有更新的数据，服务端的后写者胜触发器会跳过更新，
         * 这时保留文件，避免把更新的云端照片误删。
         */
        const applied = await this.tombstoneImage(
          uid,
          deviceId,
          'gear',
          id,
          meta.clientUpdatedAt,
        )
        if (applied) await removeStorageFile(path)
        forgetRecord('gearImage', id)
        if (gear) {
          const gearMeta = getRecordMeta('gear', id)
          markDirty('gear', id, Math.max(meta.clientUpdatedAt, gearMeta?.clientUpdatedAt ?? 0))
        }
        continue
      }

      const local = await getImage(id)
      if (!local) {
        /*
         * 本机照片丢了（浏览器清理 IndexedDB 等），但这不是用户主动删图。
         * 不能顺手删掉云端照片：只清掉这条待上传标记，避免误删。
         */
        forgetRecord('gearImage', id)
        continue
      }
      this.assertUid(uid)

      /*
       * 上传前先看远端图片行的时间：如果另一台设备已经传了更新的照片，
       * 不能把固定路径上的对象覆盖成旧图。让 pull 去下载远端版本。
       */
      const remoteAt = await this.remoteClientUpdatedAt(
        'user_images',
        uid,
        imageRowId('gear', id, 'original'),
      )
      if (remoteAt !== null && remoteAt > local.updatedAt) {
        forgetRecord('gearImage', id)
        continue
      }

      const uploaded = await this.uploadFile(path, local.blob, local.type)
      if (!uploaded) continue

      const server = await this.upsertImageRow(uid, deviceId, {
        entityType: 'gear',
        entityId: id,
        storagePath: path,
        mimeType: local.type,
        byteSize: local.size,
        clientUpdatedAt: local.updatedAt,
      })
      markClean('gearImage', id, server)

      // 装备行里的 image_path / image_updated_at 也要更新。
      // 用 max() 避免把装备文字的 clientUpdatedAt 往回拨。
      const gearMeta = getRecordMeta('gear', id)
      markDirty(
        'gear',
        id,
        Math.max(local.updatedAt, gearMeta?.clientUpdatedAt ?? 0),
      )
    }
  }

  private async pushCatchImages(uid: string, deviceId: string): Promise<void> {
    const pending = pendingRecords('catchImage')
    if (pending.length === 0) return

    const catches = new Map(
      loadCatchesRaw(activeScope()).map((item) => [item.id, item]),
    )
    for (const { id, meta } of pending) {
      this.assertUid(uid)
      const catchRecord = catches.get(id)
      const path = catchImagePath(uid, id)

      if (!catchRecord || meta.deletedAt !== null) {
        const applied = await this.tombstoneImage(
          uid,
          deviceId,
          'catch',
          id,
          meta.clientUpdatedAt,
        )
        if (applied) await removeStorageFile(path)
        forgetRecord('catchImage', id)
        continue
      }

      const local = await getCatchPhoto(id)
      if (!local) {
        // 同装备照片：本机文件丢了不等于用户删图，不能删云端
        forgetRecord('catchImage', id)
        continue
      }
      this.assertUid(uid)

      const remoteAt = await this.remoteClientUpdatedAt(
        'user_images',
        uid,
        imageRowId('catch', id, 'original'),
      )
      if (remoteAt !== null && remoteAt > local.updatedAt) {
        forgetRecord('catchImage', id)
        continue
      }

      const uploaded = await this.uploadFile(path, local.blob, local.type)
      if (!uploaded) continue

      const server = await this.upsertImageRow(uid, deviceId, {
        entityType: 'catch',
        entityId: id,
        storagePath: path,
        mimeType: local.type,
        byteSize: local.size,
        clientUpdatedAt: local.updatedAt,
      })
      markClean('catchImage', id, server)
    }
  }

  private async pushSpots(uid: string, deviceId: string): Promise<void> {
    const pending = pendingRecords('spot')
    if (pending.length === 0) return

    const local = new Map(loadSpotsRaw(activeScope()).map((item) => [item.id, item]))
    const active: Array<Record<string, unknown> & { id: string }> = []

    for (const { id, meta } of pending) {
      if (meta.deletedAt !== null) {
        await this.tombstoneRow('user_spots', uid, id, meta, deviceId)
        forgetRecord('spot', id)
        continue
      }
      const spot = local.get(id)
      if (!spot) {
        forgetRecord('spot', id)
        continue
      }
      active.push({
        ...buildSpotRow(spot, meta, uid),
        device_id: deviceId,
        deleted_at: null,
      })
    }

    if (active.length > 0) {
      const servers = await this.upsertRows('user_spots', active, 'user_id,id')
      for (const row of active) {
        markClean('spot', row.id, servers.get(row.id) ?? null)
      }
    }
  }

  private async pushTrips(uid: string, deviceId: string): Promise<void> {
    const pending = pendingRecords('trip')
    if (pending.length === 0) return

    const local = new Map(loadTripsRaw(activeScope()).map((item) => [item.id, item]))
    const active: Array<Record<string, unknown> & { id: string }> = []

    for (const { id, meta } of pending) {
      if (meta.deletedAt !== null) {
        const applied = await this.tombstoneRow('user_trips', uid, id, meta, deviceId)
        // 只有出勤墓碑真的生效时才删轨迹；不能让旧设备删掉新出勤的轨迹
        if (applied) await this.removeCloudTracks(uid, id)
        forgetRecord('trip', id)
        continue
      }
      const session = local.get(id)
      if (!session) {
        forgetRecord('trip', id)
        continue
      }
      active.push({
        ...buildTripRow(session, meta, uid),
        device_id: deviceId,
        deleted_at: null,
      })
    }

    if (active.length > 0) {
      const servers = await this.upsertRows('user_trips', active, 'user_id,id')
      for (const row of active) {
        markClean('trip', row.id, servers.get(row.id) ?? null)
      }
    }
  }

  private async pushCatches(uid: string, deviceId: string): Promise<void> {
    const pending = pendingRecords('catch')
    if (pending.length === 0) return

    const local = new Map(
      loadCatchesRaw(activeScope()).map((item) => [item.id, item]),
    )
    const active: Array<Record<string, unknown> & { id: string }> = []

    for (const { id, meta } of pending) {
      if (meta.deletedAt !== null) {
        const applied = await this.tombstoneRow('user_catches', uid, id, meta, deviceId)
        // 渔获删除通常已经把照片标成墓碑；这里再兜底清一次。
        // 同样只在墓碑生效时删文件，避免旧设备误删更新的照片。
        if (applied) {
          await this.tombstoneImage(uid, deviceId, 'catch', id, meta.clientUpdatedAt)
          await removeStorageFile(catchImagePath(uid, id))
        }
        forgetRecord('catch', id)
        continue
      }
      const record = local.get(id)
      if (!record) {
        forgetRecord('catch', id)
        continue
      }
      active.push({
        ...buildCatchRow(record, meta, uid),
        device_id: deviceId,
        deleted_at: null,
      })
    }

    if (active.length > 0) {
      const servers = await this.upsertRows('user_catches', active, 'user_id,id')
      for (const row of active) {
        markClean('catch', row.id, servers.get(row.id) ?? null)
      }
    }
  }

  private async pushGears(uid: string, deviceId: string): Promise<void> {
    const pending = pendingRecords('gear')
    if (pending.length === 0) return

    const local = new Map(loadGearRaw(activeScope()).map((item) => [item.id, item]))
    const active: Array<Record<string, unknown> & { id: string }> = []

    for (const { id, meta } of pending) {
      if (meta.deletedAt !== null) {
        const applied = await this.tombstoneRow('user_gears', uid, id, meta, deviceId)
        if (applied) {
          await this.tombstoneImage(uid, deviceId, 'gear', id, meta.clientUpdatedAt)
          await removeStorageFile(gearImagePath(uid, id))
        }
        forgetRecord('gearImage', id)
        forgetRecord('gear', id)
        continue
      }
      const gear = local.get(id)
      if (!gear) {
        forgetRecord('gear', id)
        continue
      }

      const image = await getImage(id)
      active.push({
        ...buildGearRow(
          gear,
          meta,
          uid,
          deviceId,
          image
            ? { path: gearImagePath(uid, id), updatedAt: image.updatedAt }
            : { path: null, updatedAt: null },
        ),
        deleted_at: null,
      })
    }

    if (active.length > 0) {
      const servers = await this.upsertRows('user_gears', active, 'user_id,id')
      for (const row of active) {
        markClean('gear', row.id, servers.get(row.id) ?? null)
      }
    }
  }

  private async pushPrefs(uid: string, deviceId: string): Promise<void> {
    const rows = pendingPrefRows()
    if (rows.length === 0) return

    const active: Array<Record<string, unknown> & { id: string }> = []
    for (const row of rows) {
      if (row.deleted) {
        await this.tombstoneRow(
          'user_preferences',
          uid,
          row.key,
          {
            clientUpdatedAt: row.clientUpdatedAt,
            deletedAt: row.clientUpdatedAt,
          },
          deviceId,
        )
        forgetRecord('pref', row.key)
        continue
      }
      active.push({
        user_id: uid,
        id: row.key,
        value: row.value,
        client_updated_at: row.clientUpdatedAt,
        device_id: deviceId,
        deleted_at: null,
      })
    }

    if (active.length > 0) {
      const servers = await this.upsertRows(
        'user_preferences',
        active,
        'user_id,id',
      )
      for (const row of active) {
        markClean('pref', row.id, servers.get(row.id) ?? null)
      }
    }
  }

  private async pushTracks(uid: string): Promise<void> {
    const sessions = loadTripsRaw(activeScope())
    for (const session of sessions) {
      this.assertUid(uid)
      const points = await getTrackPoints(session.id)
      const already = getTrackSynced(session.id)
      if (points.length <= already) continue

      let offset = already
      let batches = 0
      while (offset < points.length && batches < MAX_TRACK_BATCHES) {
        this.assertUid(uid)
        const batch = points.slice(offset, offset + TRACK_BATCH)
        const rows = batch.map((point) => ({
          user_id: uid,
          id: point.id,
          session_id: point.sessionId,
          latitude: point.latitude,
          longitude: point.longitude,
          recorded_at: point.recordedAt,
          accuracy: point.accuracy,
          client_updated_at: point.recordedAt,
        }))
        const rdb = await getRdb()
        const response = await rdb
          .from<Record<string, unknown>>('user_track_points')
          .upsert(rows, {
            onConflict: 'user_id,id',
            ignoreDuplicates: true,
            defaultToNull: true,
          })
        if (response.error) throw response.error

        offset += batch.length
        batches += 1
        setTrackSynced(session.id, offset)
      }
    }
  }

  private async uploadFile(path: string, blob: Blob, type: string): Promise<boolean> {
    const storage = await getStorage()
    const result = await storage.from(userMediaBucket()).upload(path, blob, {
      contentType: type || 'image/jpeg',
      upsert: true,
    })
    if (result.error) throw result.error
    return true
  }

  /** 只读远端某行的 client_updated_at；不存在时返回 null */
  private async remoteClientUpdatedAt(
    table: string,
    uid: string,
    id: string,
  ): Promise<number | null> {
    const rdb = await getRdb()
    const response = await rdb
      .from<{ client_updated_at?: number }>(table)
      .select('client_updated_at')
      .eq('user_id', uid)
      .eq('id', id)
      .limit(1)
    if (response.error) throw response.error
    const value = response.data?.[0]?.client_updated_at
    return typeof value === 'number' ? value : null
  }

  private async upsertImageRow(
    uid: string,
    deviceId: string,
    input: {
      entityType: 'gear' | 'catch'
      entityId: string
      storagePath: string
      mimeType: string
      byteSize: number
      clientUpdatedAt: number
    },
  ): Promise<string | null> {
    const row = {
      user_id: uid,
      id: imageRowId(input.entityType, input.entityId, 'original'),
      entity_type: input.entityType,
      entity_id: input.entityId,
      kind: 'original',
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      content_hash: null,
      client_updated_at: input.clientUpdatedAt,
      device_id: deviceId,
      deleted_at: null,
    }
    const servers = await this.upsertRows('user_images', [row], 'user_id,id')
    return servers.get(row.id) ?? null
  }

  /**
   * 写入图片墓碑，返回这次更新是否真的生效。
   * 服务端的后写者胜触发器可能跳过更旧的删除，此时返回 false，
   * 调用方不能删除对象存储里的文件。
   */
  private async tombstoneImage(
    uid: string,
    deviceId: string,
    entityType: 'gear' | 'catch',
    entityId: string,
    at: number,
  ): Promise<boolean> {
    const patch = {
      deleted_at: new Date(at).toISOString(),
      client_updated_at: at,
      device_id: deviceId,
    }
    try {
      const rdb = await getRdb()
      const response = await rdb
        .from<UserImageRow>('user_images')
        .update(patch)
        .eq('user_id', uid)
        .eq('id', imageRowId(entityType, entityId, 'original'))
        .select('id')
      if (response.error) throw response.error
      return (response.data?.length ?? 0) > 0
    } catch {
      // 图片行可能还没上传过；没有行就没有要删的远端记录
      return false
    }
  }

  private async upsertRows(
    table: string,
    rows: Array<Record<string, unknown> & { id: string }>,
    onConflict: string,
  ): Promise<Map<string, string | null>> {
    const rdb = await getRdb()
    const response = await rdb
      .from<{ id?: string; updated_at?: string }>(table)
      .upsert(rows, { onConflict })
      .select('id, updated_at')
    if (response.error) throw response.error

    const servers = new Map<string, string | null>()
    for (const row of response.data ?? []) {
      if (typeof row.id === 'string') {
        servers.set(row.id, typeof row.updated_at === 'string' ? row.updated_at : null)
      }
    }
    // 有些 PostgREST 配置不回传 representation；仍然算写入成功
    for (const row of rows) {
      if (!servers.has(row.id)) servers.set(row.id, null)
    }
    return servers
  }

  /** 写入行墓碑；返回 false 表示远端没有这行，或这次删除比远端数据旧而被跳过 */
  private async tombstoneRow(
    table: string,
    uid: string,
    id: string,
    meta: { deletedAt: number | null; clientUpdatedAt: number },
    deviceId: string,
  ): Promise<boolean> {
    const patch = tombstonePatch(
      {
        clientUpdatedAt: meta.clientUpdatedAt,
        deletedAt: meta.deletedAt,
      },
      deviceId,
    )
    const rdb = await getRdb()
    const response = await rdb
      .from<{ id?: string }>(table)
      .update(patch)
      .eq('user_id', uid)
      .eq('id', id)
      .select('id')
    if (response.error) throw response.error
    return (response.data?.length ?? 0) > 0
  }

  private async removeCloudTracks(uid: string, sessionId: string): Promise<void> {
    try {
      const rdb = await getRdb()
      const response = await rdb
        .from<Record<string, unknown>>('user_track_points')
        .delete()
        .eq('user_id', uid)
        .eq('session_id', sessionId)
      if (response.error) throw response.error
    } catch {
      // 轨迹清理失败不影响出勤删除；下次同步仍可重试
    }
  }

  /* ------------------------------- 拉取 ------------------------------- */

  private async pullAll(uid: string): Promise<void> {
    await this.pullSimple<UserSpotRow, Spot>({
      uid,
      kind: 'spot',
      table: 'user_spots',
      idColumn: 'id',
      map: mapSpotRow,
      apply: (updates, deletes) => {
        const changed = mergeSpots(updates, deletes)
        return changed
      },
    })

    await this.pullSimple<UserTripRow, TripSession>({
      uid,
      kind: 'trip',
      table: 'user_trips',
      idColumn: 'id',
      map: mapTripRow,
      apply: (updates, deletes) => {
        for (const id of deletes) {
          void deleteTrackPoints(id).catch(() => {
            // 本地轨迹清理失败不影响数据合并
          })
        }
        return mergeTrips(updates, deletes)
      },
    })

    await this.pullSimple<UserCatchRow, CatchRecord>({
      uid,
      kind: 'catch',
      table: 'user_catches',
      idColumn: 'id',
      map: mapCatchRow,
      apply: (updates, deletes) => mergeCatches(updates, deletes),
    })

    await this.pullSimple<UserGearRow, GearItem>({
      uid,
      kind: 'gear',
      table: 'user_gears',
      idColumn: 'id',
      map: mapGearRow,
      apply: (updates, deletes) => mergeGears(updates, deletes),
    })

    await this.pullPrefs(uid)
    // 先拉轨迹，再拉照片：单张照片失败不会挡住其它结构的同步
    await this.pullTracks(uid)
    await this.pullImages(uid)
  }

  private async pullSimple<Row, Local extends { id: string }>(options: {
    uid: string
    kind: 'spot' | 'trip' | 'catch' | 'gear'
    table: string
    idColumn: string
    map: (row: Row) => RemoteRecord<Local>
    apply: (
      updates: Map<string, Local>,
      deletes: Set<string>,
    ) => boolean | Promise<boolean>
  }): Promise<void> {
    let cursor = decodeCursor(getCursor(options.table))

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      this.assertUid(options.uid)
      const rows = await this.fetchPage<Row>(
        options.table,
        options.idColumn,
        cursor,
      )
      if (rows.length === 0) break

      const updates = new Map<string, Local>()
      const deletes = new Set<string>()
      let lastUpdatedAt: string | null = null
      let lastId: string | null = null

      for (const row of rows) {
        const remoteUpdatedAt =
          typeof (row as { updated_at?: unknown }).updated_at === 'string'
            ? ((row as { updated_at?: string }).updated_at as string)
            : null
        const id = (row as Record<string, unknown>)[options.idColumn]
        if (typeof id !== 'string') continue

        // 同一条 updated_at 已处理过的行不重复应用（gte + id 游标）
        if (
          cursor &&
          remoteUpdatedAt === cursor.updatedAt &&
          id <= cursor.id
        ) {
          lastUpdatedAt = remoteUpdatedAt
          lastId = id
          continue
        }
        lastUpdatedAt = remoteUpdatedAt
        lastId = id

        const mapped = options.map(row)
        const localMeta = getRecordMeta(options.kind, id)
        const remoteAt = mapped.clientUpdatedAt

        if (localMeta) {
          // 本地有未上传的改动，而且比远端新：保留本地，等下一轮上传
          if (localMeta.dirty && localMeta.clientUpdatedAt > remoteAt) continue
          // 本地干净且比远端新：远端是旧快照，忽略
          if (!localMeta.dirty && localMeta.clientUpdatedAt > remoteAt) {
            applyRemoteMeta(options.kind, id, localMeta.clientUpdatedAt, mapped.serverUpdatedAt)
            continue
          }
        }

        if (mapped.deleted) {
          deletes.add(id)
          forgetRecord(options.kind, id)
        } else if (mapped.record) {
          updates.set(id, mapped.record)
          applyRemoteMeta(options.kind, id, remoteAt, mapped.serverUpdatedAt)
        }
      }

      // 具体写入函数在数据真的变化时会发 remote-applied 通知
      await options.apply(updates, deletes)

      if (lastUpdatedAt && lastId) {
        setCursor(options.table, encodeCursor(lastUpdatedAt, lastId))
        cursor = { updatedAt: lastUpdatedAt, id: lastId }
      }

      if (rows.length < PAGE_SIZE) break
    }
  }

  private async pullPrefs(uid: string): Promise<void> {
    const table = 'user_preferences'
    let cursor = decodeCursor(getCursor(table))

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      this.assertUid(uid)
      const rows = await this.fetchPage<UserPrefRow>(table, 'id', cursor)
      if (rows.length === 0) break

      const applicable: PrefRow[] = []
      let lastUpdatedAt: string | null = null
      let lastId: string | null = null

      for (const row of rows) {
        const remoteUpdatedAt =
          typeof row.updated_at === 'string' ? row.updated_at : null
        const key = row.id
        if (typeof key !== 'string') continue

        if (cursor && remoteUpdatedAt === cursor.updatedAt && key <= cursor.id) {
          lastUpdatedAt = remoteUpdatedAt
          lastId = key
          continue
        }
        lastUpdatedAt = remoteUpdatedAt
        lastId = key

        const localMeta = getRecordMeta('pref', key)
        const remoteAt = typeof row.client_updated_at === 'number' ? row.client_updated_at : 0

        if (localMeta?.dirty && localMeta.clientUpdatedAt > remoteAt) continue
        if (!localMeta?.dirty && localMeta && localMeta.clientUpdatedAt > remoteAt) {
          applyRemoteMeta('pref', key, localMeta.clientUpdatedAt, serverTime(row))
          continue
        }

        if (localMeta?.dirty) {
          // 远端更新且本地有脏数据：让远端赢，先清掉脏标记
          applyRemoteMeta('pref', key, remoteAt, serverTime(row))
        } else {
          applyRemoteMeta('pref', key, remoteAt, serverTime(row))
        }

        applicable.push({
          key,
          value: row.value,
          deleted: remoteDeleted(row),
          clientUpdatedAt: remoteAt,
          serverUpdatedAt: serverTime(row),
        })
      }

      if (applicable.length > 0) applyPrefsFromRemote(applicable)

      if (lastUpdatedAt && lastId) {
        setCursor(table, encodeCursor(lastUpdatedAt, lastId))
        cursor = { updatedAt: lastUpdatedAt, id: lastId }
      }
      if (rows.length < PAGE_SIZE) break
    }
  }

  private async pullImages(uid: string): Promise<void> {
    const table = 'user_images'
    let cursor = decodeCursor(getCursor(table))

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      this.assertUid(uid)
      const rows = await this.fetchPage<UserImageRow>(table, 'id', cursor)
      if (rows.length === 0) break

      let lastUpdatedAt: string | null = null
      let lastId: string | null = null
      let downloadFailed = false

      for (const row of rows) {
        const remoteUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null
        const id = row.id
        if (typeof id !== 'string') continue

        if (cursor && remoteUpdatedAt === cursor.updatedAt && id <= cursor.id) {
          lastUpdatedAt = remoteUpdatedAt
          lastId = id
          continue
        }
        lastUpdatedAt = remoteUpdatedAt
        lastId = id

        if (row.entity_type !== 'gear' && row.entity_type !== 'catch') continue
        if (row.kind !== 'original') continue

        const entityId = row.entity_id
        if (typeof entityId !== 'string' || !entityId) continue
        const kind = row.entity_type === 'gear' ? 'gearImage' : 'catchImage'
        const remoteAt =
          typeof row.client_updated_at === 'number' ? row.client_updated_at : 0
        const localMeta = getRecordMeta(kind, entityId)

        if (localMeta?.dirty && localMeta.clientUpdatedAt > remoteAt) continue
        if (!localMeta?.dirty && localMeta && localMeta.clientUpdatedAt > remoteAt) {
          applyRemoteMeta(kind, entityId, localMeta.clientUpdatedAt, serverTime(row))
          continue
        }

        if (remoteDeleted(row) || !row.storage_path) {
          if (row.entity_type === 'gear') await deleteImageFromRemote(entityId)
          else await deleteCatchPhotoFromRemote(entityId)
          forgetRecord(kind, entityId)
          continue
        }

        const exists =
          row.entity_type === 'gear'
            ? loadGearRaw(activeScope()).some((item) => item.id === entityId)
            : loadCatchesRaw(activeScope()).some((item) => item.id === entityId)
        if (!exists) {
          // 实体已被删除，图片也不需要留在本机
          if (row.entity_type === 'gear') await deleteImageFromRemote(entityId)
          else await deleteCatchPhotoFromRemote(entityId)
          forgetRecord(kind, entityId)
          continue
        }

        const localImage =
          row.entity_type === 'gear'
            ? await getImage(entityId)
            : await getCatchPhoto(entityId)
        const updatedAt = remoteAt || Date.now()

        if (!localImage || localImage.updatedAt !== updatedAt) {
          const blob = await this.downloadImage(row.storage_path)
          if (!blob) {
            // 不推进游标，下一轮会从这一页重新尝试；其它数据已经先同步完
            downloadFailed = true
            break
          }
          if (row.entity_type === 'gear') {
            await putImageFromRemote(entityId, blob, updatedAt)
          } else {
            await putCatchPhotoFromRemote(entityId, blob, updatedAt)
          }
        }
        applyRemoteMeta(kind, entityId, remoteAt, serverTime(row))
      }

      if (downloadFailed) {
        throw new CloudApiError(
          'image-download-failed',
          '部分照片暂未下载成功，文字记录已经同步；联网稳定后会自动重试照片',
        )
      }

      if (lastUpdatedAt && lastId) {
        setCursor(table, encodeCursor(lastUpdatedAt, lastId))
        cursor = { updatedAt: lastUpdatedAt, id: lastId }
      }
      if (rows.length < PAGE_SIZE) break
    }
  }

  private async pullTracks(uid: string): Promise<void> {
    const table = 'user_track_points'
    let cursor = decodeCursor(getCursor(table))
    const sessionIds = new Set(loadTripsRaw(activeScope()).map((item) => item.id))

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      this.assertUid(uid)
      const rows = await this.fetchPage<UserTrackRow>(table, 'id', cursor)
      if (rows.length === 0) break

      const points: TrackPoint[] = []
      let lastUpdatedAt: string | null = null
      let lastId: string | null = null

      for (const row of rows) {
        const remoteUpdatedAt = typeof row.updated_at === 'string' ? row.updated_at : null
        const id = row.id
        if (typeof id !== 'string') continue

        if (cursor && remoteUpdatedAt === cursor.updatedAt && id <= cursor.id) {
          lastUpdatedAt = remoteUpdatedAt
          lastId = id
          continue
        }
        lastUpdatedAt = remoteUpdatedAt
        lastId = id

        if (!sessionIds.has(row.session_id)) continue
        const point = mapTrackRow(row)
        if (point) points.push(point)
      }

      if (points.length > 0) await putTrackPointsFromRemote(points)

      if (lastUpdatedAt && lastId) {
        setCursor(table, encodeCursor(lastUpdatedAt, lastId))
        cursor = { updatedAt: lastUpdatedAt, id: lastId }
      }
      if (rows.length < PAGE_SIZE) break
    }
  }

  private async fetchPage<Row>(
    table: string,
    idColumn: string,
    cursor: { updatedAt: string; id: string } | null,
  ): Promise<Row[]> {
    const rdb = await getRdb()
    const base = () =>
      rdb
        .from<Row>(table)
        .select('*')
        .order('updated_at', { ascending: true })
        .order(idColumn, { ascending: true })

    if (!cursor) {
      const response = await base().limit(PAGE_SIZE)
      if (response.error) throw response.error
      return response.data ?? []
    }

    /*
     * 键集分页，避开 PostgREST 的 or/and 组合语法，兼容性更稳：
     * 1. 先取「同一 updated_at、id 更大」的行（服务端会把一批 upsert 写成同一时间）
     * 2. 不够一页时，再取「updated_at 更大」的行
     *
     * 直接使用服务端返回的原始时间字符串，不经过 Date 转换，
     * 否则会丢掉 PostgreSQL 的微秒精度，可能漏掉同一毫秒内的行。
     */
    if (!/^\d{4}-\d{2}-\d{2}T/.test(cursor.updatedAt)) {
      // 游标损坏时重新全量拉取（合并操作幂等）
      const response = await base().limit(PAGE_SIZE)
      if (response.error) throw response.error
      return response.data ?? []
    }

    const sameTime = await base()
      .eq('updated_at', cursor.updatedAt)
      .gt(idColumn, cursor.id)
      .limit(PAGE_SIZE)
    if (sameTime.error) throw sameTime.error
    const rows = sameTime.data ?? []
    if (rows.length >= PAGE_SIZE) return rows

    const later = await base()
      .gt('updated_at', cursor.updatedAt)
      .limit(PAGE_SIZE - rows.length)
    if (later.error) throw later.error
    return rows.concat(later.data ?? [])
  }

  private async downloadImage(path: string): Promise<Blob | null> {
    try {
      const storage = await getStorage()
      const result = await storage.from(userMediaBucket()).download(path)
      if (result.error) throw result.error
      return result.data
    } catch {
      return null
    }
  }
}

/* ------------------------------- 合并函数 ------------------------------- */

function mergeSpots(
  updates: Map<string, Spot>,
  deletes: Set<string>,
): boolean {
  const local = loadSpotsRaw(activeScope())
  const next = mergeList(local, updates, deletes)
  if (!changedList(local, next)) return false
  return applySpotsFromRemote(next)
}

function mergeTrips(
  updates: Map<string, TripSession>,
  deletes: Set<string>,
): boolean {
  const local = loadTripsRaw(activeScope())
  const next = mergeList(local, updates, deletes)
  if (!changedList(local, next)) return false
  return applyTripsFromRemote(next)
}

function mergeCatches(
  updates: Map<string, CatchRecord>,
  deletes: Set<string>,
): boolean {
  const local = loadCatchesRaw(activeScope())
  const next = mergeList(local, updates, deletes)
  if (!changedList(local, next)) return false
  return applyCatchesFromRemote(next)
}

function mergeGears(
  updates: Map<string, GearItem>,
  deletes: Set<string>,
): boolean {
  const local = loadGearRaw(activeScope())
  const next = mergeList(local, updates, deletes)
  if (!changedList(local, next)) return false
  return applyGearFromRemote(next)
}

function mergeList<T extends { id: string }>(
  local: T[],
  updates: Map<string, T>,
  deletes: Set<string>,
): T[] {
  const seen = new Set<string>()
  const next: T[] = []

  for (const item of local) {
    if (deletes.has(item.id)) continue
    next.push(updates.get(item.id) ?? item)
    seen.add(item.id)
  }
  for (const [id, item] of updates) {
    if (seen.has(id) || deletes.has(id)) continue
    next.push(item)
  }
  return next
}

function changedList<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return true
  return JSON.stringify(a) !== JSON.stringify(b)
}

/* ------------------------------- 工具函数 ------------------------------- */

function imageRowId(
  entityType: 'gear' | 'catch',
  entityId: string,
  kind: string,
): string {
  return `${entityType}:${entityId}:${kind}`
}

function safeSegment(value: string): string {
  return encodeURIComponent(value)
}

export function gearImagePath(uid: string, gearId: string): string {
  return `${safeSegment(uid)}/gear/${safeSegment(gearId)}/original`
}

export function catchImagePath(uid: string, catchId: string): string {
  return `${safeSegment(uid)}/catch/${safeSegment(catchId)}/original`
}

async function removeStorageFile(path: string): Promise<void> {
  try {
    const storage = await getStorage()
    const result = await storage.from(userMediaBucket()).remove([path])
    if (result.error) throw result.error
  } catch {
    // 文件不存在或没有权限都不影响数据库墓碑
  }
}

const CURSOR_SEP = '\u0001'

function encodeCursor(updatedAt: string, id: string): string {
  return `${updatedAt}${CURSOR_SEP}${id}`
}

function decodeCursor(value: string | null): { updatedAt: string; id: string } | null {
  if (!value) return null
  const index = value.indexOf(CURSOR_SEP)
  if (index <= 0) return null
  return { updatedAt: value.slice(0, index), id: value.slice(index + 1) }
}

/* ------------------------ 单例 + 对外接口 ------------------------ */

const engine = new Engine()

export function subscribeSyncState(
  listener: (snapshot: SyncSnapshot) => void,
): () => void {
  return engine.subscribe(listener)
}

export function getSyncSnapshot(): SyncSnapshot {
  return engine.getSnapshot()
}

export function startSync(uid: string): void {
  engine.start(uid)
}

export function stopSync(): void {
  engine.stop()
}

export function syncNow(): Promise<void> {
  return engine.syncNow()
}

export function claimLocalData(): Promise<ClaimResult> {
  return engine.claimLocalData()
}

export function refreshClaimState(): Promise<void> {
  return engine.refreshClaim()
}

/** 只读诊断：本机旧数据是否还存在（绝不迁移、绝不删除） */
export async function legacySnapshot(): Promise<LegacySummary> {
  return summarizeLegacy()
}
