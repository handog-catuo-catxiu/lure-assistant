import { CATEGORY_META, type GearCategory } from '../types/gear'
import type { CatalogPhoto } from '../types/catalog'
import { IMAGE_SOURCE_LABEL, resolveGearImage } from '../lib/gearImage'
import GearPlaceholder from './GearPlaceholder'
import { CATEGORY_ICONS } from './icons'
import './GearImage.css'

interface GearImageProps {
  category: GearCategory
  name: string
  /** 用户上传照片的 object URL */
  userImageUrl?: string | null
  /** 图鉴里该产品的授权照片 */
  photo?: CatalogPhoto | null
  /** thumb = 列表缩略图，cover = 详情大图 */
  variant?: 'thumb' | 'cover'
  /** 是否在图片上标注来源 */
  showBadge?: boolean
}

/**
 * 按「用户照片 > 图鉴照片 > 分类示意图」的顺序展示装备图片。
 * 示意图会被明确标注，不会冒充实物照片。
 */
export default function GearImage({
  category,
  name,
  userImageUrl,
  photo,
  variant = 'thumb',
  showBadge = false,
}: GearImageProps) {
  const resolved = resolveGearImage({ userImageUrl, catalogPhoto: photo })
  const Icon = CATEGORY_ICONS[category]

  let visual
  if (resolved.url) {
    visual = (
      <img
        className="gear-image__img"
        src={resolved.url}
        alt={`${name} 的${resolved.source === 'user' ? '照片' : '图鉴图片'}`}
        loading="lazy"
      />
    )
  } else if (variant === 'cover') {
    visual = <GearPlaceholder category={category} />
  } else {
    // 缩略图尺寸下画示意图太糊，直接用统一风格的图标块
    visual = (
      <span className="gear-image__tile" data-category={category}>
        <Icon size={variant === 'thumb' ? 28 : 20} />
      </span>
    )
  }

  return (
    <div
      className={`gear-image gear-image--${variant}`}
      data-category={category}
      data-source={resolved.source}
    >
      {visual}
      {showBadge && (
        <span className="gear-image__badge" title={resolved.credit ?? CATEGORY_META[category].label}>
          {IMAGE_SOURCE_LABEL[resolved.source]}
        </span>
      )}
    </div>
  )
}
