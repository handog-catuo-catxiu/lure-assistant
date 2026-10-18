import type { GearCategory, GearSpec } from './gear'

/**
 * 图鉴产品的真实照片。
 * 只有确认来源可靠、允许展示时才填写；图片必须是放在 public/ 下的本地文件，
 * 不使用第三方站点抓取的图片或不稳定的外链。
 */
export interface CatalogPhoto {
  /**
   * 图片来源。可以是 public/ 下的站点路径（例如 /catalog/xxx.jpg），
   * 也可以是对象存储/CDN 的完整网址（http/https）。
   */
  path: string
  /** 来源说明，界面上会标出来 */
  credit: string
  /** 授权说明，例如「厂商官方图，已获授权」 */
  license: string
}

/**
 * 图鉴产品：与用户自己的装备分开存放的公共目录。
 *
 * 正式数据从 CloudBase PostgreSQL 的官方图鉴表读取；内置的 data/catalog.ts
 * 只是离线/未配置云端时的示例，界面会明确标出来。
 */
export interface CatalogProduct {
  id: string
  brand: string
  /** 型号名称 */
  name: string
  category: GearCategory
  spec: GearSpec
  /** 没有可靠授权的照片时留空，界面退回分类示意图 */
  photo?: CatalogPhoto
  /** 品牌 id（官方表的稳定标识） */
  brandId?: string
  /** 系列名，例如「月影 MX」 */
  series?: string
  /** 官方描述，可以留空 */
  description?: string
  /** 对象存储/CDN 的稳定图片地址 */
  imageUrl?: string
  /** 官方资料出处（核对规格时记录） */
  officialSource?: string
  status?: 'active' | 'discontinued' | 'hidden'
}
