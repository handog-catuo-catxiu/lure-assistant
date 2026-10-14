/**
 * 品牌 Logo 素材。
 * 只有拿到合法、可靠、允许使用的素材时才登记，官方 Logo 属于品牌方商标。
 */
export interface BrandLogoAsset {
  /** public 目录下的路径，例如 /brands/daiwa.svg */
  path: string
  /** 素材来源 */
  credit: string
  /** 授权说明 */
  license: string
}

export interface BrandEntry {
  /** 品牌唯一标识，同时决定文字 Logo 的配色，保证同一品牌中英文写法颜色一致 */
  id: string
  /** 规范名称 */
  name: string
  /** 常见中英文写法 */
  aliases: string[]
  /** 品牌 Logo 素材，没有合法素材时留空，界面自动回退为文字 Logo */
  logo?: BrandLogoAsset
}
