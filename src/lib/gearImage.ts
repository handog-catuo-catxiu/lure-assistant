import { findCachedCatalogProduct } from './cloud/catalog'
import { publicUrl } from './publicUrl'
import type { CatalogPhoto, CatalogProduct } from '../types/catalog'

/**
 * 图片优先级：用户自己上传的照片 > 图鉴授权照片 > 分类示意图。
 * 示意图是画出来的占位图，不是任何真实产品的照片。
 */
export type GearImageSource = 'user' | 'catalog' | 'placeholder'

export const IMAGE_SOURCE_LABEL: Record<GearImageSource, string> = {
  user: '我的照片',
  catalog: '图鉴图片',
  placeholder: '示意图 · 非实物照片',
}

export interface ResolvedGearImage {
  source: GearImageSource
  /** 可以直接放进 <img src> 的地址；示意图时为 null */
  url: string | null
  /** 图鉴图片的来源说明 */
  credit?: string
}

export function resolveGearImage(options: {
  userImageUrl?: string | null
  catalogPhoto?: CatalogPhoto | null
}): ResolvedGearImage {
  if (options.userImageUrl) {
    return { source: 'user', url: options.userImageUrl }
  }

  const photo = options.catalogPhoto
  if (photo?.path) {
    // 站点内路径补上部署 base；对象存储/CDN 的完整网址原样使用
    return {
      source: 'catalog',
      url: publicUrl(photo.path),
      credit: photo.credit,
    }
  }

  return { source: 'placeholder', url: null }
}

/**
 * 按 id 查图鉴产品。同步读取浏览缓存和内置示例；
 * 云端数据由 CatalogPicker / 装备表单在打开时异步写入缓存。
 */
export function findCatalogProduct(
  catalogId: string | undefined | null,
): CatalogProduct | null {
  return findCachedCatalogProduct(catalogId)
}

/** 装备关联的图鉴照片（没有关联或图鉴没有照片时返回 null） */
export function catalogPhotoOf(catalogId: string | undefined | null): CatalogPhoto | null {
  const product = findCatalogProduct(catalogId)
  if (!product) return null
  if (product.photo) return product.photo
  if (product.imageUrl) {
    return {
      path: product.imageUrl,
      credit: '官方图鉴图片',
      license: '官方资料',
    }
  }
  return null
}
