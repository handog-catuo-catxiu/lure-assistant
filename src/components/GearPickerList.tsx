import BrandTile from './BrandTile'
import GearImage from './GearImage'
import { CheckIcon } from './icons'
import { catalogPhotoOf } from '../lib/gearImage'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  formatSpec,
  type GearCategory,
  type GearItem,
} from '../types/gear'
import './GearPickerList.css'

interface GearPickerListProps {
  items: GearItem[]
  /** 用户上传的照片，按装备 id 索引 */
  imageUrls: Record<string, { url: string }>
  selectedIds: string[]
  onToggle: (gearId: string) => void
  emptyText?: string
}

/**
 * 按分类分组的装备多选列表：鱼竿、渔轮、拟饵、周边装备都可以同时选多件。
 * 开始出勤的装备步骤和「管理本次装备」共用这一个组件。
 */
export default function GearPickerList({
  items,
  imageUrls,
  selectedIds,
  onToggle,
  emptyText = '装备库还是空的，可以先跳过这一步',
}: GearPickerListProps) {
  const selected = new Set(selectedIds)

  if (items.length === 0) {
    return (
      <div className="pick-empty">
        <p className="pick-empty__text">{emptyText}</p>
        <p className="pick-empty__hint">
          可以先去「装备」页添加装备，也可以直接跳过，之后随时补充
        </p>
      </div>
    )
  }

  return (
    <div className="pick-list">
      {CATEGORY_ORDER.map((category: GearCategory) => {
        const group = items.filter((item) => item.category === category)
        if (group.length === 0) return null

        const chosen = group.filter((item) => selected.has(item.id)).length

        return (
          <section className="pick-group" key={category}>
            <div className="pick-group__head">
              <h3 className="pick-group__title">{CATEGORY_META[category].label}</h3>
              <span className="pick-group__count">
                {chosen > 0 ? `已选 ${chosen} / 共 ${group.length}` : `共 ${group.length}`}
              </span>
            </div>

            <ul className="pick-group__list">
              {group.map((item) => {
                const active = selected.has(item.id)
                const summary = [item.brand, formatSpec(item.category, item.spec)]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`pick-item${active ? ' pick-item--active' : ''}`}
                      aria-pressed={active}
                      onClick={() => onToggle(item.id)}
                    >
                      {/* 与首页列表一致：开了「显示装备图片」就显示照片，否则显示品牌标记 */}
                      {item.showImageOnHome ? (
                        <GearImage
                          category={item.category}
                          name={item.name}
                          userImageUrl={imageUrls[item.id]?.url ?? null}
                          photo={catalogPhotoOf(item.catalogId)}
                          variant="thumb"
                        />
                      ) : (
                        <BrandTile brand={item.brand} />
                      )}

                      <span className="pick-item__body">
                        <span className="pick-item__name">{item.name}</span>
                        <span className="pick-item__spec">
                          {summary || CATEGORY_META[item.category].label}
                        </span>
                      </span>

                      <span className="pick-item__check" aria-hidden="true">
                        {active && <CheckIcon size={15} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
