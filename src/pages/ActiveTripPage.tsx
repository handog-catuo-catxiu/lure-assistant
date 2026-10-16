import { useRef, useState } from 'react'
import CatchEditModal from '../components/CatchEditModal'
import CatchList from '../components/CatchList'
import ConfirmDialog from '../components/ConfirmDialog'
import GeoStatusPanel from '../components/GeoStatusPanel'
import Toast from '../components/Toast'
import TopBar from '../components/TopBar'
import TripGearModal from '../components/TripGearModal'
import TripMap from '../components/TripMap'
import { FishIcon, StopIcon } from '../components/icons'
import { useCatchEditor } from '../hooks/useCatchEditor'
import { useElapsed } from '../hooks/useElapsed'
import {
  describeDistanceSource,
  formatDistance,
  isLocationUsableForCatch,
} from '../lib/geo'
import { formatClock, formatTimer } from '../lib/tripFormat'
import { resolveSessionGear } from '../lib/tripService'
import { passTapGuard } from '../lib/tapGuard'
import type { CatchPhotoLibraryApi } from '../hooks/useCatchPhotos'
import type { GearApi } from '../hooks/useGear'
import type { ImageLibraryApi } from '../hooks/useImageLibrary'
import type { TripApi } from '../hooks/useTrip'
import type { GeoRowItem } from '../components/GeoStatusPanel'
import type { TripTrackApi } from '../hooks/useTripTrack'
import type { CatchSavePayload, TripSession } from '../types/trip'
import './ActiveTripPage.css'

/**
 * 两次「一键上鱼」之间至少要隔这么久（毫秒）。
 * 目的是挡掉手抖连点造成的重复记录，不是限制连续上鱼：
 * 正常一条一条记，间隔远大于这个值。
 */
const CATCH_TAP_COOLDOWN = 1000

interface ActiveTripPageProps {
  trip: TripApi
  gear: GearApi
  images: ImageLibraryApi
  catchPhotos: CatchPhotoLibraryApi
  /** 应用级的轨迹记录器（全局只有这一条高德定位循环） */
  track: TripTrackApi
  sessionId: string
  onBack: () => void
  onEnded: (session: TripSession) => void
}

/** 正在出勤：实时时长、一键上鱼、GPS 定位与轨迹、本次装备与结束出勤 */
export default function ActiveTripPage({
  trip,
  gear,
  images,
  catchPhotos,
  track,
  sessionId,
  onBack,
  onEnded,
}: ActiveTripPageProps) {
  const session = trip.sessionById(sessionId)
  const isActive = session?.status === 'active'

  // 时长由真实开始时间算出，刷新、锁屏回来都还是对的
  const elapsed = useElapsed(isActive && session ? session.startedAt : null)

  // 渔获的补充 / 编辑 / 删除都在这个 hook 里，页面内的提示也统一用它那条 Toast
  const editor = useCatchEditor({ trip, catchPhotos })

  const [gearModalOpen, setGearModalOpen] = useState(false)
  const [pendingEnd, setPendingEnd] = useState(false)
  const catchTapRef = useRef(0)

  if (!session) {
    return (
      <div className="active-trip">
        <TopBar title="正在出勤" onBack={onBack} />
        <div className="active-trip__notice">
          <p className="active-trip__notice-text">这场出勤不存在，可能已经被删除。</p>
        </div>
      </div>
    )
  }

  const catches = trip.catchesOf(session.id)
  const gearRefs = resolveSessionGear(gear.items, session.gearIds)
  const stepsText = session.steps !== undefined ? String(session.steps) : '—'
  const castsText = session.castCount !== undefined ? String(session.castCount) : '—'

  // 轨迹相关的两行，补在 GPS 卡片的坐标后面
  const trackRows: GeoRowItem[] = [
    { label: '轨迹点', value: `${track.summary.pointCount} 个` },
    { label: '已记录距离', value: formatDistance(track.summary.meters) },
  ]

  function handleAddCatch() {
    if (!session || session.status !== 'active') return

    // 连点保护：同一秒内的第二次点击直接丢掉，避免一次上鱼记成两条
    if (!passTapGuard(catchTapRef, CATCH_TAP_COOLDOWN)) return

    /*
     * 只有「此刻手上就有新鲜且够准的定位」才把坐标写进渔获。
     * 没有合格的定位就留空——不会用标点坐标顶替，
     * 也不会为了等一次定位而把这次保存往后拖。
     */
    const fix = track.getLatestPosition()
    const location = isLocationUsableForCatch(fix) ? fix : null

    // 先落库（这一步是同步写 localStorage），再打开补充界面
    const result = trip.addCatchNow(session.id, location)
    if (!result.ok) {
      editor.showToast(result.error)
      return
    }
    editor.showToast('已记录一条渔获')
    editor.openEditor(result.value)
  }

  function handleSaveGear(gearIds: string[]): string | null {
    if (!session) return '这场出勤不存在'

    const result = trip.setTripGear(session.id, gearIds)
    if (!result.ok) return result.error
    editor.showToast('已更新本次出勤装备')
    return null
  }

  function handleSaveCatch(payload: CatchSavePayload): string | null {
    const record = editor.editing
    if (!record) return '找不到这条渔获'
    return editor.saveCatch(record, payload)
  }

  function handleConfirmEnd() {
    if (!session) return
    setPendingEnd(false)

    const result = trip.endTrip(session.id)
    if (!result.ok) {
      editor.showToast(result.error)
      return
    }
    // 结束后的统计与总结交给出勤详情页展示
    onEnded(result.value)
  }

  // 这条渔获所属的出勤：正在出勤页里通常就是它自己
  const editingSession = editor.editing
    ? trip.sessionById(editor.editing.sessionId) ?? session
    : null

  return (
    <div className="active-trip">
      <TopBar
        title="正在出勤"
        subtitle={session.spotName || '标点已删除'}
        onBack={onBack}
        backLabel="返回"
      />

      <section className="active-trip__hero">
        <span className="active-trip__badge">
          <span className="active-trip__dot" aria-hidden="true" />
          {session.status === 'active' ? '出勤中' : '已结束'}
        </span>

        <h2 className="active-trip__spot">{session.spotName || '标点已删除'}</h2>
        <p className="active-trip__started">
          {formatClock(session.startedAt)} 开始
          {session.endedAt !== null && ` · ${formatClock(session.endedAt)} 结束`}
        </p>

        <div className="active-trip__timer">
          <strong>{formatTimer(elapsed)}</strong>
          <span className="active-trip__timer-units">
            <span>时</span>
            <span>分</span>
            <span>秒</span>
          </span>
        </div>

        <div className="active-trip__stats">
          <div className="active-trip__stat">
            <strong>{catches.length}</strong>
            <span>本次渔获</span>
          </div>
          <div className="active-trip__stat-divider" />
          <div className="active-trip__stat">
            <strong>{session.gearIds.length}</strong>
            <span>出勤装备</span>
          </div>
        </div>

        {/* 步数与抛投次数：网页版拿不到手机的运动数据，明确标成暂不支持 */}
        <div className="active-trip__future">
          <div className="active-trip__future-item">
            <span className="active-trip__future-label">步数</span>
            <span className="active-trip__future-value">{stepsText}</span>
            {session.steps === undefined && (
              <span className="active-trip__future-tag">暂不支持</span>
            )}
          </div>
          <div className="active-trip__future-item">
            <span className="active-trip__future-label">抛投次数</span>
            <span className="active-trip__future-value">{castsText}</span>
            {session.castCount === undefined && (
              <span className="active-trip__future-tag">暂不支持</span>
            )}
          </div>
        </div>
      </section>

      {session.status === 'active' ? (
        <section className="active-trip__section">
          <button type="button" className="catch-button" onClick={handleAddCatch}>
            <FishIcon size={26} />
            <span className="catch-button__text">
              一键上鱼
              <em>点一下先记下来，鱼种照片之后再补</em>
            </span>
          </button>
        </section>
      ) : (
        <section className="active-trip__section">
          <p className="active-trip__ended-hint">
            这场出勤已经结束，不能继续上鱼了，但已有的渔获仍然可以编辑。
          </p>
        </section>
      )}

      {/*
        GPS 放在一键上鱼下面：上鱼始终是这一页最重要的操作，
        定位信息要能看得到，但不能把上鱼按钮挤下去。
      */}
      <section className="active-trip__section">
        <GeoStatusPanel
          subtitle={session.spotName || '标点已删除'}
          point={track.latest}
          status={track.status}
          error={track.error}
          warning={track.warning}
          backgrounded={track.backgrounded}
          recording={track.recording}
          extraRows={trackRows}
          note={track.storageError}
          disabled={session.status !== 'active'}
          onRefresh={track.refresh}
          onToggleRecording={() => (track.recording ? track.pause() : track.start())}
          onRetry={track.restart}
        />
      </section>

      <section className="active-trip__section">
        <div className="active-trip__head">
          <h3 className="active-trip__heading">轨迹地图</h3>
          <span className="active-trip__count">{track.summary.pointCount} 个点</span>
        </div>

        <TripMap
          points={track.points}
          current={track.latest}
          spots={trip.spots}
          catches={catches}
          height={240}
          emptyText="还没有轨迹点。开始记录后，走过的地方会实时画在这里"
        />

        <p className="active-trip__map-note">
          {describeDistanceSource(track.summary.meters)}
        </p>
      </section>

      <section className="active-trip__section">
        <div className="active-trip__head">
          <h3 className="active-trip__heading">本次渔获</h3>
          <span className="active-trip__count">共 {catches.length} 条</span>
        </div>

        <CatchList
          catches={catches}
          gearItems={gear.items}
          photos={catchPhotos.photos}
          onEdit={editor.openEditor}
          onDelete={editor.requestDelete}
          emptyText="还没有上鱼记录"
          emptyHint="上鱼时点上面的「一键上鱼」，先记下来再慢慢补信息"
        />
      </section>

      <section className="active-trip__section">
        <div className="active-trip__head">
          <h3 className="active-trip__heading">出勤装备</h3>
          <button
            type="button"
            className="link-btn"
            onClick={() => setGearModalOpen(true)}
            disabled={session.status !== 'active'}
          >
            管理
          </button>
        </div>

        {gearRefs.length > 0 ? (
          <ul className="gear-ref-list">
            {gearRefs.map((ref) => (
              <li className="gear-ref" key={ref.id}>
                <span className={`gear-ref__name${ref.deleted ? ' gear-ref__name--deleted' : ''}`}>
                  {ref.name}
                </span>
                {ref.brand && <span className="gear-ref__brand">{ref.brand}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="active-trip__gear-empty">
            这次没带装备，需要的话点「管理」加进来
          </p>
        )}
      </section>

      {session.status === 'active' && (
        <section className="active-trip__section">
          <button
            type="button"
            className="active-trip__end"
            onClick={() => setPendingEnd(true)}
          >
            <StopIcon size={18} />
            结束出勤
          </button>
        </section>
      )}

      {gearModalOpen && (
        <TripGearModal
          session={session}
          gearItems={gear.items}
          imageUrls={images.images}
          onClose={() => setGearModalOpen(false)}
          onSave={handleSaveGear}
        />
      )}

      {editor.editing && editingSession && (
        <CatchEditModal
          record={editor.editing}
          session={editingSession}
          gearItems={gear.items}
          photoUrl={catchPhotos.photos[editor.editing.id]?.url ?? null}
          currentLocation={track.latest}
          onClose={editor.closeEditor}
          onSave={handleSaveCatch}
        />
      )}

      {editor.pendingDelete && (
        <ConfirmDialog
          title="删除渔获"
          message="确定要删除这条渔获记录吗？"
          highlight={`${formatClock(editor.pendingDelete.caughtAt)} ${
            editor.pendingDelete.species || '未填写鱼种'
          }`}
          confirmText="删除"
          danger
          onConfirm={editor.confirmDelete}
          onCancel={editor.cancelDelete}
        />
      )}

      {pendingEnd && (
        <ConfirmDialog
          title="结束出勤"
          message="结束后这场出勤会保存到历史记录，之后不能再新增渔获（已有的渔获仍然可以编辑）。"
          highlight={`${session.spotName || '标点已删除'} · 已进行 ${formatTimer(elapsed)}`}
          confirmText="结束出勤"
          danger
          onConfirm={handleConfirmEnd}
          onCancel={() => setPendingEnd(false)}
        />
      )}

      <Toast message={editor.toastMessage} />
    </div>
  )
}
