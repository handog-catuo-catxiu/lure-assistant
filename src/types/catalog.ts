import type { GearCategory, GearSpec } from './gear'

/**
 * 图鉴产品的真实照片。
 * 只有确认来源可靠、允许展示时才填写；图片必须是放在 public/ 下的本地文件，
 * 不使用第三方站点抓取的图片或不稳定的外链。
 */
export interface CatalogPhoto {
  /** 本地路径，例如 /catalog/daiwa-mx-2500s.jpg */
  path: string
  /** 来源说明，界面上会标出来 */
  credit: string
  /** 授权说明，例如「厂商官方图，已获授权」 */
  license: string
}

/** 图鉴产品：与用户自己的装备分开存放的公共目录 */
export interface CatalogProduct {
  id: string
  brand: string
  /** 型号名称 */
  name: string
  category: GearCategory
  spec: GearSpec
  /** 没有可靠授权的照片时留空，界面退回分类示意图 */
  photo?: CatalogPhoto
}
