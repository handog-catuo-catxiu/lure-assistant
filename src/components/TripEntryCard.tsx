import { useElapsed } from '../hooks/useElapsed'
import { formatClock, formatTimer } from '../lib/tripFormat'
import { ClockIcon, FishIcon, PlayIcon } from './icons'
import type { TripSession } from '../types/trip'
import './TripEntryCard.css'

interface TripEntryCardProps {
  /** 进行中的出勤；没有传 null */
  session: TripSession | null
  /** 进行中出勤的渔获数 */
  catchCount?: number
  onStart: () => void
  onResume: () => void
}

/**
 * 出勤入口：装备页（首页）和出勤页共用。
 * 有进行中的出勤就显示实时状态，否则是「开始出勤」的主操作。
 */
export default function TripEntryCard({
  session,
  catchCount = 0,
  onStart,
  onResume,
}: TripEntryCardProps) {
  // 时长由真实开始时间算出来，锁屏、切后台、刷新后回来都是准的
  const elapsed = useElapsed(session?.startedAt ?? null)

  if (!session) {
    return (
      <section className="trip-entry">
        <div className="trip-entry__text">
          <h2 className="trip-entry__title">今天出门抛两竿？</h2>
          <p className="trip-entry__desc">
            选个标点、挑上这次带出去的装备，出勤时长和渔获都会记下来
          </p>
        </div>
        <button type="button" className="trip-entry__start" onClick={onStart}>
          <PlayIcon size={18} />
          开始出勤
        </button>
      </section>
    )
  }

  return (
    <section className="trip-entry trip-entry--active">
      <div className="trip-entry__live">
        <span className="trip-entry__badge">
          <span className="trip-entry__dot" aria-hidden="true" />
          正在出勤
        </span>
        <h2 className="trip-entry__spot">{session.spotName || '未命名标点'}</h2>
        <p className="trip-entry__meta">
          {formatClock(session.startedAt)} 开始 · 渔获 {catchCount} 条 · 装备{' '}
          {session.gearIds.length} 件
        </p>
      </div>

      <div className="trip-entry__timer">
        <ClockIcon size={16} />
        <strong>{formatTimer(elapsed)}</strong>
      </div>

      <button type="button" className="trip-entry__resume" onClick={onResume}>
        <FishIcon size={18} />
        回到出勤
      </button>
    </section>
  )
}
