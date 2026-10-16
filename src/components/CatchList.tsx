import CatchPhoto from './CatchPhoto'
import { FishIcon, LocateIcon } from './icons'
import { formatCoordinateShort } from '../lib/geo'
import { formatClockSec, formatLength, formatWeight } from '../lib/tripFormat'
import { resolveGear } from '../lib/tripService'
import { CATCH_GEAR_FIELD, CATCH_GEAR_CATEGORIES } from '../types/trip'
import type { CatchRecord, CatchGearCategory } from '../types/trip'
import type { GearItem } from '../types/gear'
import './CatchList.css'

/** 渔获装备在列表里的简称：竿 / 轮 / 饵 */
const GEAR_SHORT_LABEL: Record<CatchGearCategory, string> = {
  rod: '竿',
  reel: '轮',
  lure: '饵',
}

interface CatchListProps {
  catches: CatchRecord[]
  gearItems: GearItem[]
  /** 渔获照片，按渔获 id 索引 */
  photos: Record<string, { url: string }>
  onEdit: (record: CatchRecord) => void
  onDelete: (record: CatchRecord) => void
  emptyText: string
  emptyHint?: string
}

/** 渔获列表。正在出勤页和历史详情页共用 */
export default function CatchList({
  catches,
  gearItems,
  photos,
  onEdit,
  onDelete,
  emptyText,
  emptyHint,
}: CatchListProps) {
  if (catches.length === 0) {
    return (
      <div className="catch-empty">
        <span className="catch-empty__icon" aria-hidden="true">
          <FishIcon size={22} />
        </span>
        <p className="catch-empty__text">{emptyText}</p>
        {emptyHint && <p className="catch-empty__hint">{emptyHint}</p>}
      </div>
    )
  }

  return (
    <ul className="catch-list">
      {catches.map((record) => {
        const size = [
          record.lengthCm !== null ? formatLength(record.lengthCm) : null,
          record.weightG !== null ? formatWeight(record.weightG) : null,
        ].filter((text): text is string => text !== null)

        // 实际用到的装备：装备被删除后这里显示「装备已删除」，不会报错
        const gear = CATCH_GEAR_CATEGORIES.map((category) => {
          const ref = resolveGear(gearItems, record[CATCH_GEAR_FIELD[category]])
          return ref ? `${GEAR_SHORT_LABEL[category]} ${ref.name}` : null
        }).filter((text): text is string => text !== null)

        return (
          <li className="catch-row" key={record.id}>
            <CatchPhoto
              url={photos[record.id]?.url ?? null}
              variant="thumb"
              alt={record.species ? `${record.species} 的照片` : '渔获照片'}
            />

            <div className="catch-row__body">
              <div className="catch-row__head">
                <span className="catch-row__time">{formatClockSec(record.caughtAt)}</span>
                <span className={`catch-row__species${record.species ? '' : ' catch-row__species--blank'}`}>
                  {record.species || '未填写鱼种'}
                </span>
              </div>

              {size.length > 0 && (
                <p className="catch-row__size">{size.join(' · ')}</p>
              )}
              {gear.length > 0 && <p className="catch-row__gear">{gear.join(' · ')}</p>}
              {/* 有位置就显示出来；没有位置的老记录什么也不显示，不占地方 */}
              {record.latitude !== undefined && record.longitude !== undefined && (
                <p className="catch-row__geo">
                  <LocateIcon size={12} />
                  {formatCoordinateShort(record.latitude, record.longitude)}
                </p>
              )}
              {record.note && <p className="catch-row__note">{record.note}</p>}

              <div className="catch-row__actions">
                <button type="button" className="link-btn" onClick={() => onEdit(record)}>
                  补充 / 编辑
                </button>
                <button
                  type="button"
                  className="link-btn link-btn--danger"
                  onClick={() => onDelete(record)}
                >
                  删除
                </button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
