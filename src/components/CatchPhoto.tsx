import { FishIcon } from './icons'
import './CatchPhoto.css'

interface CatchPhotoProps {
  /** 渔获照片的 object URL，还没有照片时为 null */
  url: string | null
  /** thumb = 列表缩略图，cover = 编辑界面大图，tile = 档案网格里的 4:5 卡片图 */
  variant?: 'thumb' | 'cover' | 'tile'
  alt?: string
}

/** 渔获照片。没有照片时显示鱼形占位，不会出现碎图 */
export default function CatchPhoto({
  url,
  variant = 'thumb',
  alt = '渔获照片',
}: CatchPhotoProps) {
  return (
    <div className={`catch-photo catch-photo--${variant}`} data-empty={!url}>
      {url ? (
        <img className="catch-photo__img" src={url} alt={alt} loading="lazy" />
      ) : (
        <FishIcon size={variant === 'thumb' ? 24 : 40} />
      )}
    </div>
  )
}
