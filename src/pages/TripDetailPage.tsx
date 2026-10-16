import CatchEditModal from '../components/CatchEditModal'
import CatchList from '../components/CatchList'
import ConfirmDialog from '../components/ConfirmDialog'
import Toast from '../components/Toast'
import TopBar from '../components/TopBar'
import TrackPlayback from '../components/TrackPlayback'
import TripMap from '../components/TripMap'
import { CheckIcon, FishIcon } from '../components/icons'
import { useCatchEditor } from '../hooks/useCatchEditor'
import { useElapsed } from '../hooks/useElapsed'
import { useStoredTrack, type TripTrackApi } from '../hooks/useTripTrack'
import { describeDistanceSource, formatDistance } from '../lib/geo'
import { formatClock, formatClockSec, formatDateCN, formatDuration } from '../lib/tripFormat'
import { resolveSessionGear } from '../lib/tripService'
import type { CatchPhotoLibraryApi } from '../hooks/useCatchPhotos'
import type { GearApi } from '../hooks/useGear'
import type { TripApi } from '../hooks/useTrip'
import type { CatchSavePayload } from '../types/trip'
import './TripDetailPage.css'

interface TripDetailPageProps {
  trip: TripApi
  gear: GearApi
  catchPhotos: CatchPhotoLibraryApi
  /** 应用级的轨迹记录器：正好在看这场进行中的出勤时直接用它，不用再读一次库 */
  track: TripTrackApi
  sessionId: string
  /**
   * summary：刚结束出勤，展示这次出勤的总结；
   * history：从历史记录点进来，看某一场出勤的详情。
   * 两者内容一致，只有标题和收尾按钮不同。
   */
  variant: 'summary' | 'history'
  onBack: () => void
  /** 总结页的「完成」，回到出勤标签页 */
  onDone: () => void
}

/**
 * 出勤详情：这场出勤的标点、时间、时长、装备与全部渔获。
 * 结束出勤后在这里看总结，之后从历史记录里再进来看到的是同一份内容。
 */
export default function TripDetailPage({
  trip,
  gear,
  catchPhotos,
  track,
  sessionId,
  variant,
  onBack,
  onDone,
}: TripDetailPageProps) {
  const session = trip.sessionById(sessionId)
  const isSummary = variant === 'summary'

  // 还在进行中的出勤（从历史列表点进来）也要有个走得准的时长
  const elapsed = useElapsed(session && session.status === 'active' ? session.startedAt : null)

  const editor = useCatchEditor({ trip, catchPhotos })

  /*
   * 看的正好是正在进行的那场出勤，就直接用内存里那份（也是最新的）；
   * 其它情况从 IndexedDB 里读已经存下来的轨迹，不启动任何定位。
   */
  const isLiveTrack = track.sessionId !== null && track.sessionId === sessionId
  const stored = useStoredTrack(isLiveTrack ? null : sessionId)

  const trackPoints = isLiveTrack ? track.points : stored.points
  const trackSummary = isLiveTrack ? track.summary : stored.summary
  const trackReady = isLiveTrack ? track.ready : stored.ready
  const trackError = isLiveTrack ? track.storageError : stored.error

  if (!session) {
    return (
      <div className="trip-detail">
        <TopBar title={isSummary ? '出勤总结' : '出勤详情'} onBack={onBack} />
        <div className="trip-detail__notice">
          <p className="trip-detail__notice-text">这场出勤不存在，可能已经被删除。</p>
        </div>
      </div>
    )
  }

  const isActive = session.status === 'active'
  const catches = trip.catchesOf(session.id)
  const gearRefs = resolveSessionGear(gear.items, session.gearIds)
  const durationMs =
    session.endedAt !== null ? session.endedAt - session.startedAt : elapsed

  const editingSession = editor.editing
    ? trip.sessionById(editor.editing.sessionId) ?? session
    : null

  function handleSaveCatch(payload: CatchSavePayload): string | null {
    const record = editor.editing
    if (!record) return '找不到这条渔获'
    return editor.saveCatch(record, payload)
  }

  return (
    <div className="trip-detail">
      <TopBar
        title={isSummary ? '出勤总结' : '出勤详情'}
        subtitle={session.spotName || '标点已删除'}
        onBack={onBack}
        backLabel={isSummary ? '返回出勤' : '返回历史出勤'}
      />

      <section className="trip-detail__hero">
        <span className="trip-detail__badge">
          {isActive ? '进行中' : isSummary ? '已结束 · 已存入历史' : '已结束'}
        </span>

        <h2 className="trip-detail__spot">{session.spotName || '标点已删除'}</h2>
        <p className="trip-detail__date">{formatDateCN(session.startedAt)}</p>

        <dl className="trip-detail__grid">
          <div className="trip-detail__cell">
            <dt>开始时间</dt>
            <dd>{formatClockSec(session.startedAt)}</dd>
          </div>
          <div className="trip-detail__cell">
            <dt>结束时间</dt>
            <dd>{session.endedAt !== null ? formatClockSec(session.endedAt) : '—'}</dd>
          </div>
          <div className="trip-detail__cell">
            <dt>总时长</dt>
            <dd>{formatDuration(durationMs)}</dd>
          </div>
          <div className="trip-detail__cell">
            <dt>渔获数</dt>
            <dd>{catches.length} 条</dd>
          </div>
          <div className="trip-detail__cell">
            <dt>GPS 距离</dt>
            <dd>{formatDistance(trackSummary.meters)}</dd>
          </div>
        </dl>
      </section>

      <section className="trip-detail__section">
        <div className="trip-detail__head">
          <h3 className="trip-detail__heading">轨迹</h3>
          <span className="trip-detail__count">
            {trackSummary.pointCount > 0 ? `${trackSummary.pointCount} 个点` : '暂无轨迹'}
          </span>
        </div>

        {trackError && (
          <p className="trip-detail__hint trip-detail__hint--error">{trackError}</p>
        )}

        <TripMap
          points={trackPoints}
          spots={trip.spots}
          catches={catches}
          height={240}
          emptyText={
            trackReady
              ? '这场出勤没有记录轨迹点，地图上只显示有坐标的标点和渔获'
              : '正在读取轨迹…'
          }
        />

        <p className="trip-detail__hint">
          {describeDistanceSource(trackSummary.meters)}
          {trackSummary.breakCount > 0 &&
            `；中途有 ${trackSummary.breakCount} 处定位中断，那几段的路程没有计入。`}
        </p>

        {trackSummary.pointCount >= 2 && (
          <TrackPlayback
            // 换一场出勤就重新挂载，回放自然回到开头
            key={session.id}
            points={trackPoints}
            catches={catches}
            spots={trip.spots}
            height={220}
          />
        )}
      </section>

      <section className="trip-detail__section">
        <div className="trip-detail__head">
          <h3 className="trip-detail__heading">出勤装备</h3>
          <span className="trip-detail__count">共 {gearRefs.length} 件</span>
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
          <p className="trip-detail__empty">这次出勤没有记录装备</p>
        )}
      </section>

      <section className="trip-detail__section">
        <div className="trip-detail__head">
          <h3 className="trip-detail__heading">渔获</h3>
          <span className="trip-detail__count">共 {catches.length} 条</span>
        </div>

        <CatchList
          catches={catches}
          gearItems={gear.items}
          photos={catchPhotos.photos}
          onEdit={editor.openEditor}
          onDelete={editor.requestDelete}
          emptyText="这次出勤没有渔获记录"
          emptyHint={
            isActive
              ? '回到正在出勤页，上鱼时点「一键上鱼」'
              : '已经结束的出勤不能再补记渔获了'
          }
        />

        {!isActive && catches.length > 0 && (
          <p className="trip-detail__hint">
            出勤已经结束，不能新增渔获，但每条渔获都还能补充或修改。
          </p>
        )}
      </section>

      {isSummary && (
        <section className="trip-detail__section">
          <button type="button" className="trip-detail__done" onClick={onDone}>
            <CheckIcon size={18} />
            完成，回到出勤记录
          </button>
        </section>
      )}

      {editor.editing && editingSession && (
        <CatchEditModal
          record={editor.editing}
          session={editingSession}
          gearItems={gear.items}
          photoUrl={catchPhotos.photos[editor.editing.id]?.url ?? null}
          currentLocation={isLiveTrack ? track.latest : null}
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

      {isSummary && catches.length === 0 && (
        <p className="trip-detail__foot-note">
          <FishIcon size={14} />
          这次没上鱼，出门本身也算数
        </p>
      )}

      <Toast message={editor.toastMessage} />
    </div>
  )
}
