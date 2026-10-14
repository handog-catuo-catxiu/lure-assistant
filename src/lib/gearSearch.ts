import type { CatalogProduct } from '../types/catalog'
import { CATEGORY_META, SPEC_FIELDS, type GearCategory, type GearItem } from '../types/gear'
import { findBrand } from './brandLogo'

/** 核心匹配：空格分隔的多个关键词需要全部命中，例如「达亿瓦 ML」 */
export function matchesKeywords(text: string, query: string): boolean {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true

  const haystack = text.toLowerCase()
  return keyword.split(/\s+/).every((word) => haystack.includes(word))
}

/** 规格值拼成的搜索文本（鱼竿的长度/调性、渔轮的型号/速比、拟饵的类型/重量） */
function specSearchText(category: GearCategory, spec: CatalogProduct['spec']): string {
  return SPEC_FIELDS[category]
    .map((field) => spec[field.key])
    .filter((value): value is string => Boolean(value))
    .join(' ')
}

/**
 * 品牌的全部写法：复用品牌表里的别名，让搜「DAIWA」也能命中存成「达亿瓦」的产品，
 * 反过来同理。复用 findBrand，不另建一套中英文映射。
 */
function brandSearchText(brand: string): string {
  const entry = findBrand(brand)
  return entry ? [brand, ...entry.aliases].join(' ') : brand
}

/**
 * 装备的搜索文本：名称、品牌（含中英文别名）、分类名，以及该分类的全部规格值。
 * 备注不参与搜索，避免按意图之外的关键词命中。
 */
export function gearSearchText(item: GearItem): string {
  return [
    item.name,
    brandSearchText(item.brand),
    CATEGORY_META[item.category].label,
    specSearchText(item.category, item.spec),
  ].join(' ')
}

export function gearMatchesQuery(item: GearItem, query: string): boolean {
  return matchesKeywords(gearSearchText(item), query)
}

/** 图鉴产品的搜索文本：品牌（含中英文别名）、型号名、分类名、规格值 */
export function catalogSearchText(product: CatalogProduct): string {
  return [
    product.name,
    brandSearchText(product.brand),
    CATEGORY_META[product.category].label,
    specSearchText(product.category, product.spec),
  ].join(' ')
}

export function catalogMatchesQuery(product: CatalogProduct, query: string): boolean {
  return matchesKeywords(catalogSearchText(product), query)
}
