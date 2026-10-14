import { useState, type CSSProperties } from 'react'
import { resolveBrandTile } from '../lib/brandLogo'
import { publicUrl } from '../lib/publicUrl'
import { BoxIcon } from './icons'
import './BrandTile.css'

interface BrandTileProps {
  /** 装备的 brand 字段，允许为空 */
  brand: string
}

/**
 * 首页列表左侧的品牌标记。
 * 登记了 Logo 素材且文件存在时显示真实 Logo（contain 居中，保持原始比例），
 * 否则显示品牌文字或缩写；文件缺失或加载失败会自动回退，不会出现碎图。
 * 外层容器与装备照片共用 mediaFrame.css 里的同一套尺寸（64 × 64），
 * 三种情况互换时列表不会错位。
 */
export default function BrandTile({ brand }: BrandTileProps) {
  const tile = resolveBrandTile(brand)
  // 记住加载失败的地址，而不是一个布尔值：换素材后能自动重试
  const [failedPath, setFailedPath] = useState<string | null>(null)

  // 登记表里是 '/brand-logos/…' 这种 public 根路径，要补上部署 base 才请求得到
  const logoPath = publicUrl(tile.logo?.path)
  const showLogo = logoPath !== null && logoPath !== failedPath

  const hasBrand = tile.label.length > 0
  const title = hasBrand ? tile.title : '未填写品牌'

  return (
    <span
      className={`brand-tile${showLogo ? ' brand-tile--logo' : ''}${
        hasBrand || showLogo ? '' : ' brand-tile--blank'
      }`}
      style={{ '--brand-hue': tile.hue } as CSSProperties}
      role="img"
      aria-label={hasBrand ? `${tile.title} 品牌标记` : title}
      title={title}
    >
      {showLogo ? (
        <img
          className="brand-tile__logo"
          src={logoPath}
          alt=""
          onError={() => setFailedPath(logoPath)}
        />
      ) : hasBrand ? (
        <span className="brand-tile__label" aria-hidden="true">
          {tile.label}
        </span>
      ) : (
        <BoxIcon size={26} />
      )}
    </span>
  )
}
