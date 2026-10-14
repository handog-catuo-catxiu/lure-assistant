import { CATALOG } from '../data/catalog'
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
    // photo.path 是按 public/ 根路径登记的，补上部署 base 才能真的请求到
    return { source: 'catalog', url: publicUrl(photo.path), credit: photo.credit }
  }

  return { source: 'placeholder', url: null }
}

const CATALOG_BY_ID = new Map(CATALOG.map((product) => [product.id, product]))

export function findCatalogProduct(
  catalogId: string | undefined | null,
): CatalogProduct | null {
  if (!catalogId) return null
  return CATALOG_BY_ID.get(catalogId) ?? null
}

/** 装备关联的图鉴照片（没有关联或图鉴没有照片时返回 null） */
export function catalogPhotoOf(catalogId: string | undefined | null): CatalogPhoto | null {
  return findCatalogProduct(catalogId)?.photo ?? null
}
