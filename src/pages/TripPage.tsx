import PageHeader from '../components/PageHeader'
import TripEntryCard from '../components/TripEntryCard'
import { ChevronRightIcon, ClockIcon, PlayIcon } from '../components/icons'
import { useElapsed } from '../hooks/useElapsed'
import {
  formatClock,
  formatDateCN,
  formatDuration,
} from '../lib/tripFormat'
import type { TripApi } from '../hooks/useTrip'
import type { TripSession } from '../types/trip'
import './TripPage.css'

interface TripPageProps {
  trip: TripApi
  onStart: () => void
  onResume: () => void
  onOpenDetail: (sessionId: string) => void
}

interface TripCardProps {
  session: TripSession
  catchCount: number
  onOpen: () => void
}

/**
 * 历史列表里的一行。单独拆成组件是为了让进行中的那一场
 * 能走 useElapsed 自己计时，而不是在渲染里直接读当前时间。
 */
function TripCard({ session, catchCount, onOpen }: TripCardProps) {
  const isActive = session.status === 'active'
  const elapsed = useElapsed(isActive ? session.startedAt : null)
  const endedAt = session.endedAt ?? session.startedAt

  return (
    <li>
      <button
        type="button"
        className={`trip-card${isActive ? ' trip-card--active' : ''}`}
        onClick={onOpen}
      >
        <span className="trip-card__body">
          <span className="trip-card__head">
            <span className="trip-card__date">
              {formatDateCN(session.startedAt)}
            </span>
            {isActive && <span className="trip-card__live">进行中</span>}
          </span>

          <span className="trip-card__spot">
            {session.spotName || '标点已删除'}
          </span>

          <span className="trip-card__meta">
            {formatClock(session.startedAt)} –{' '}
            {isActive ? '进行中' : formatClock(endedAt)}
            {' · '}
            {isActive
              ? `已进行 ${formatDuration(elapsed)}`
              : formatDuration(endedAt - session.startedAt)}
            {' · '}渔获 {catchCount} 条
          </span>
        </span>

        <span className="trip-card__chevron" aria-hidden="true">
          <ChevronRightIcon size={18} />
        </span>
      </button>
    </li>
  )
}

/** 出勤页：上面是当前出勤状态，下面是历史出勤列表 */
export default function TripPage({
  trip,
  onStart,
  onResume,
  onOpenDetail,
}: TripPageProps) {
  const active = trip.activeSession
  const history = trip.historySessions

  return (
    <div className="trip-page">
      <PageHeader title="出勤" subtitle="一键上鱼、出勤计时与历史记录">
        <div className="page-header__stats">
          <div className="page-header__stat">
            <strong>{history.length}</strong>
            <span>出勤场次</span>
          </div>
          <div className="page-header__divider" />
          <div className="page-header__stat">
            <strong>{trip.catches.length}</strong>
            <span>渔获总条数</span>
          </div>
        </div>
      </PageHeader>

      <section className="trip-page__section">
        <TripEntryCard
          session={active}
          catchCount={active ? trip.catchCountOf(active.id) : 0}
          onStart={onStart}
          onResume={onResume}
        />
      </section>

      <section className="trip-page__section">
        <div className="trip-page__list-head">
          <h2 className="trip-page__heading">历史出勤</h2>
          <span className="trip-page__count">共 {history.length} 场</span>
        </div>

        {history.length > 0 ? (
          <ul className="trip-page__list">
            {history.map((session) => (
              <TripCard
                key={session.id}
                session={session}
                catchCount={trip.catchCountOf(session.id)}
                onOpen={() => onOpenDetail(session.id)}
              />
            ))}
          </ul>
        ) : (
          <div className="trip-page__empty">
            <span className="trip-page__empty-icon" aria-hidden="true">
              <ClockIcon size={22} />
            </span>
            <p className="trip-page__empty-text">
              还没有出勤记录，开始第一场出勤吧
            </p>
            <p className="trip-page__empty-hint">
              每次出勤的时长、装备和渔获都会自动记下来
            </p>
            {!active && (
              <button type="button" className="trip-page__empty-btn" onClick={onStart}>
                <PlayIcon size={16} />
                开始出勤
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
