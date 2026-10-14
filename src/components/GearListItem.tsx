import { CATEGORY_META, formatSpec, type GearItem } from '../types/gear'
import { catalogPhotoOf } from '../lib/gearImage'
import BrandTile from './BrandTile'
import GearImage from './GearImage'
import { StarIcon } from './icons'
import './GearListItem.css'

interface GearListItemProps {
  item: GearItem
  /** 用户上传照片的预览地址 */
  userImageUrl?: string | null
  onOpen: (item: GearItem) => void
  onEdit: (item: GearItem) => void
  onDelete: (item: GearItem) => void
  onToggleFavorite: (id: string) => void
}

export default function GearListItem({
  item,
  userImageUrl = null,
  onOpen,
  onEdit,
  onDelete,
  onToggleFavorite,
}: GearListItemProps) {
  const meta = CATEGORY_META[item.category]

  // 品牌与规格可能都为空，拼出来是空的就整行不渲染
  const summary = [item.brand, formatSpec(item.category, item.spec)]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="gear-item" data-category={item.category}>
      {/* 覆盖整张卡片的按钮，让「点卡片看详情」可点击也可键盘操作 */}
      <button
        type="button"
        className="gear-item__open"
        onClick={() => onOpen(item)}
        aria-label={`查看「${item.name}」的详情`}
        title="点击查看详情"
      />

      {/* 左侧默认显示品牌标记；在详情页打开「在首页显示装备图片」后改显示装备图片 */}
      {item.showImageOnHome ? (
        <GearImage
          category={item.category}
          name={item.name}
          userImageUrl={userImageUrl}
          photo={catalogPhotoOf(item.catalogId)}
          variant="thumb"
        />
      ) : (
        <BrandTile brand={item.brand} />
      )}

      <div className="gear-item__body">
        <div className="gear-item__head">
          <h3 className="gear-item__name">{item.name}</h3>
          <button
            type="button"
            className={`gear-item__star${item.favorite ? ' gear-item__star--on' : ''}`}
            onClick={() => onToggleFavorite(item.id)}
            aria-pressed={item.favorite}
            aria-label={item.favorite ? '取消常用标记' : '标记为常用装备'}
            title={item.favorite ? '取消常用标记' : '标记为常用装备'}
          >
            <StarIcon size={18} filled={item.favorite} />
          </button>
        </div>

        {summary && <p className="gear-item__spec">{summary}</p>}
        {item.note && <p className="gear-item__note">{item.note}</p>}

        <div className="gear-item__foot">
          <div className="gear-item__meta">
            <span className="gear-item__tag">{meta.label}</span>
            {item.purchasedAt && (
              <span className="gear-item__date">入手 {item.purchasedAt}</span>
            )}
          </div>

          <div className="gear-item__actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => onEdit(item)}
            >
              编辑
            </button>
            <button
              type="button"
              className="link-btn link-btn--danger"
              onClick={() => onDelete(item)}
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}
