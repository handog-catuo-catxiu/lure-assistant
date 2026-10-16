import { LocateIcon, PauseIcon, PlayIcon, RefreshIcon } from './icons'
import { useNow } from '../hooks/useNow'
import {
  describeGeoStatus,
  describeLocationSource,
  formatAccuracy,
  formatCoordinate,
  formatFixAge,
  isFixFresh,
} from '../lib/geo'
import { formatClockSec } from '../lib/tripFormat'
import type { GeoStatus } from '../lib/geo'
import type { LiveGeoPoint } from '../types/trip'
import './GeoStatus.css'

/** 一行「标签 —— 值」，开始出勤页和正在出勤页共用 */
export interface GeoRowItem {
  label: string
  value: string
  muted?: boolean
}

export function GeoRows({ rows }: { rows: GeoRowItem[] }) {
  return (
    <dl className="geo-rows">
      {rows.map((row) => (
        <div className="geo-row" key={row.label}>
          <dt className="geo-row__label">{row.label}</dt>
          <dd className={`geo-row__value${row.muted ? ' geo-row__value--muted' : ''}`}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

interface GeoStatusPanelProps {
  /** 卡片副标题，例如当前标点名 */
  subtitle?: string
  point: LiveGeoPoint | null
  status: GeoStatus
  /** 硬失败：权限被拒、浏览器不支持 */
  error: string | null
  /** 软提示：监听还在跑，只是这一会儿没拿到读数 */
  warning?: string | null
  /** 刚从后台回来：轨迹可能有断点 */
  backgrounded: boolean
  recording: boolean
  /** 轨迹相关的补充行，例如已记录的点数与距离 */
  extraRows?: GeoRowItem[]
  /** 额外的说明或警告 */
  note?: string | null
  /** 出勤已结束等情况下禁用操作 */
  disabled?: boolean
  onRefresh: () => void
  onToggleRecording: () => void
  onRetry: () => void
}

/**
 * 正在出勤页的 GPS 状态卡片：标点、坐标、精度、最后定位时间、轨迹状态。
 * 拿不到定位就明说「尚未定位」，不会显示任何编出来的坐标。
 */
export default function GeoStatusPanel({
  subtitle,
  point,
  status,
  error,
  warning = null,
  backgrounded,
  recording,
  extraRows = [],
  note,
  disabled = false,
  onRefresh,
  onToggleRecording,
  onRetry,
}: GeoStatusPanelProps) {
  /*
   * 高德拿不到设备定位时会退回 IP 定位。它不是「定位成功」，
   * 只是一张很粗的参考图，所以：徽章改口、单独给一条醒目说明，
   * 并且说明它不会进标点 / 渔获 / 轨迹。
   */
  const ipBased = point !== null && point.source === 'ip'
  const badge = describeGeoStatus(status, { recording, ip: ipBased })
  // 有软提示时也给一个「重新尝试定位」：定位可能已经卡住，重开一次最快
  const canRetry =
    status === 'denied' || status === 'error' || status === 'unsupported' || warning !== null

  /*
   * 手上这条读数还新不新。旧了就说「上次定位」，标上时间；
   * 绝不让一条十分钟前的坐标冒充「当前坐标」。
   */
  const now = useNow(10_000)
  const pointStale =
    point !== null &&
    (!isFixFresh(point.recordedAt, now) ||
      status === 'error' ||
      status === 'denied' ||
      status === 'paused')

  const rows: GeoRowItem[] = [
    {
      label: pointStale ? '上次定位坐标' : '当前坐标',
      value: point ? formatCoordinate(point.latitude, point.longitude) : '尚未定位',
      muted: !point,
    },
    {
      label: pointStale ? '上次定位精度' : '定位精度',
      value: point ? formatAccuracy(point.accuracy) : '—',
      muted: !point,
    },
    {
      label: '最后读数时间',
      value: point
        ? `${formatClockSec(point.recordedAt)}${
            pointStale ? ` · ${formatFixAge(point.recordedAt, now)}` : ''
          }`
        : '—',
      muted: !point,
    },
    ...extraRows,
  ]

  return (
    <section className="geo-card">
      <div className="geo-card__head">
        <div>
          <h3 className="geo-card__title">
            <LocateIcon size={17} />
            GPS 定位
          </h3>
          {subtitle && <p className="geo-card__subtitle">{subtitle}</p>}
        </div>
        <span className={`geo-badge geo-badge--${badge.tone}`}>{badge.label}</span>
      </div>

      <GeoRows rows={rows} />

      {ipBased && (
        <p className="geo-note geo-note--warn">
          高德这次没拿到设备定位，退回的是<strong>{describeLocationSource('ip')}</strong>
          ——靠网络出口推断出来的，误差可能有好几公里，只能在地图上当个参考。
          它不会写进标点、渔获，也不会记进轨迹；要准确位置请走到开阔处点「重新尝试定位」。
        </p>
      )}

      {pointStale && point && (
        <p className="geo-note geo-note--warn">
          上面这条是 {formatClockSec(point.recordedAt)}（{formatFixAge(point.recordedAt, now)}
          ）拿到的位置，<strong>不是现在的位置</strong>。点「刷新定位」再取一次；
          这期间上的鱼不会写坐标，也不会拿这条旧读数顶替。
        </p>
      )}

      {backgrounded && (
        <p className="geo-note geo-note--warn">
          刚才切到后台或锁屏了。iPhone 上网页定位会在这段时间暂停，轨迹可能因此断开一段——
          这段时间的路程不会被算进距离，回来之后会继续记录。
        </p>
      )}

      {warning && <p className="geo-note geo-note--warn">{warning}</p>}
      {error && <p className="geo-note geo-note--error">{error}</p>}
      {note && <p className="geo-note">{note}</p>}

      <div className="geo-actions">
        <button
          type="button"
          className="geo-btn"
          onClick={onRefresh}
          disabled={disabled || status === 'unsupported'}
        >
          <RefreshIcon size={16} />
          刷新定位
        </button>

        <button
          type="button"
          className={`geo-btn${recording ? ' geo-btn--danger' : ' geo-btn--primary'}`}
          onClick={onToggleRecording}
          disabled={disabled || status === 'unsupported'}
        >
          {recording ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          {recording ? '暂停记录' : '开始记录'}
        </button>

        {canRetry && (
          <button
            type="button"
            className="geo-btn"
            onClick={onRetry}
            disabled={disabled || status === 'unsupported'}
          >
            <LocateIcon size={16} />
            重新尝试定位
          </button>
        )}
      </div>
    </section>
  )
}
