import CatchPhoto from './CatchPhoto'
import { formatDate, formatLength, formatWeight } from '../lib/tripFormat'
import type { CatchRecord } from '../types/trip'
import './CatchCard.css'

interface CatchCardProps {
  record: CatchRecord
  /** 已有照片的 object URL；没有照片时显示鱼的占位图 */
  photoUrl: string | null
  /** 关联钓点的名字；没有关联或标点已删除时给 null */
  spotName: string | null
  onOpen: (catchId: string) => void
}

/**
 * 渔获档案里的一格。整格都是按钮，点进详情。
 *
 * 照片永远是 4:5，用 object-fit: cover 裁切，不拉伸变形；
 * 长度和重量为空时那一项直接不显示 —— 宁可少一行，也不写「0 cm」。
 */
export default function CatchCard({ record, photoUrl, spotName, onOpen }: CatchCardProps) {
  const title = record.species.trim() || '未填写鱼种'

  return (
    <button
      type="button"
      className="catch-card"
      onClick={() => onOpen(record.id)}
      aria-label={`查看渔获：${title}`}
    >
      <CatchPhoto variant="tile" url={photoUrl} alt={`${title}的照片`} />

      <div className="catch-card__body">
        <p className="catch-card__name">{title}</p>
        <p className="catch-card__date">{formatDate(record.caughtAt)}</p>

        {(record.lengthCm !== null || record.weightG !== null) && (
          <p className="catch-card__tags">
            {record.lengthCm !== null && <span>{formatLength(record.lengthCm)}</span>}
            {record.weightG !== null && <span>{formatWeight(record.weightG)}</span>}
          </p>
        )}

        <p className="catch-card__spot">{spotName ?? '没有关联钓点'}</p>
      </div>
    </button>
  )
}
