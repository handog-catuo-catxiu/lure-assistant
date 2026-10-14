import type { ReactNode } from 'react'
import GearImage from './GearImage'
import Modal from './Modal'
import ToggleSwitch from './ToggleSwitch'
import { CATEGORY_ICONS, StarIcon } from './icons'
import { findCatalogProduct } from '../lib/gearImage'
import {
  CATEGORY_META,
  SPEC_FIELDS,
  formatSpec,
  type GearItem,
} from '../types/gear'
import './GearDetailModal.css'

/** 距入手日期的天数，日期不合法时返回 null */
function daysSince(dateISO: string): number | null {
  const time = Date.parse(dateISO)
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function purchasedText(dateISO: string): string {
  if (!dateISO) return '未填写'

  const days = daysSince(dateISO)
  if (days === null) return dateISO
  if (days === 0) return `${dateISO} · 今天入手`
  return `${dateISO} · 已入手 ${days} 天`
}

interface RowProps {
  label: string
  children: ReactNode
  stacked?: boolean
}

function Row({ label, children, stacked = false }: RowProps) {
  return (
    <div className={`detail-row${stacked ? ' detail-row--stacked' : ''}`}>
      <dt className="detail-row__label">{label}</dt>
      <dd className="detail-row__value">{children}</dd>
    </div>
  )
}

interface GearDetailModalProps {
  item: GearItem
  /** 用户上传照片的预览地址 */
  userImageUrl?: string | null
  onClose: () => void
  onEdit: (item: GearItem) => void
  onDelete: (item: GearItem) => void
  onToggleFavorite: (id: string) => void
  /** 切换「在首页显示装备图片」，立即生效并写入 localStorage */
  onToggleShowImageOnHome: (id: string, value: boolean) => void
}

export default function GearDetailModal({
  item,
  userImageUrl = null,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
  onToggleShowImageOnHome,
}: GearDetailModalProps) {
  const meta = CATEGORY_META[item.category]
  const Icon = CATEGORY_ICONS[item.category]
  const summary = [item.brand, formatSpec(item.category, item.spec)]
    .filter(Boolean)
    .join(' · ')
  const catalogProduct = findCatalogProduct(item.catalogId)

  return (
    <Modal
      title="装备详情"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => onDelete(item)}
          >
            删除
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onEdit(item)}
          >
            编辑
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            返回
          </button>
        </>
      }
    >
      <div className="detail">
        <GearImage
          category={item.category}
          name={item.name}
          userImageUrl={userImageUrl}
          photo={catalogProduct?.photo ?? null}
          variant="cover"
          showBadge
        />

        {/* 图片区开关：控制首页列表左侧显示装备图片还是品牌标记 */}
        <label className="detail__image-switch">
          <span className="detail__image-switch-text">
            在首页显示装备图片
            <em>关闭时首页显示品牌 Logo</em>
          </span>
          <ToggleSwitch
            checked={item.showImageOnHome}
            onChange={(value) => onToggleShowImageOnHome(item.id, value)}
            label="在首页显示装备图片"
          />
        </label>

        <div className="detail__hero" data-category={item.category}>
          <span className="detail__hero-icon">
            <Icon size={22} />
          </span>
          <div className="detail__hero-text">
            <span className="detail__hero-tag">{meta.label}</span>
            <h3 className="detail__hero-name">{item.name}</h3>
            {summary && <p className="detail__hero-spec">{summary}</p>}
          </div>
        </div>

        <dl className="detail__rows">
          <Row label="分类">{meta.label}</Row>
          <Row label="品牌">{item.brand || '未填写'}</Row>

          {catalogProduct && (
            <Row label="图鉴产品">
              {catalogProduct.brand} {catalogProduct.name}
            </Row>
          )}

          {SPEC_FIELDS[item.category].map((field) => (
            <Row key={field.key} label={field.label}>
              {item.spec[field.key]?.trim() || '未填写'}
            </Row>
          ))}

          <Row label="入手日期">{purchasedText(item.purchasedAt)}</Row>

          <Row label="常用状态">
            <button
              type="button"
              className={`detail__fav${item.favorite ? ' detail__fav--on' : ''}`}
              onClick={() => onToggleFavorite(item.id)}
              aria-pressed={item.favorite}
            >
              <StarIcon size={15} filled={item.favorite} />
              {item.favorite ? '已设为常用' : '标记为常用'}
            </button>
          </Row>

          <Row label="备注" stacked>
            {item.note || '暂无备注'}
          </Row>
        </dl>
      </div>
    </Modal>
  )
}
