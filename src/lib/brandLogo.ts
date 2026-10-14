import { BRANDS } from '../data/brands'
import type { BrandEntry, BrandLogoAsset } from '../types/brand'

/** 去掉空格、括号和标点并转小写，让「DAIWA」「daiwa（达亿瓦）」「阿布·加西亚」都能对上 */
function normalizeBrandKey(value: string): string {
  return value
    .toLowerCase()
    // \s 已经包含全角空格，中英文之间的空格都能去掉
    .replace(/\s+/g, '')
    .replace(/[（）()[\]【】「」『』《》<>·.、,，/\\|~—\-_+*'"“”]+/g, '')
}

/** 匹配品牌：先精确匹配写法，再在 brand 里带了多余文字时用包含匹配 */
export function findBrand(brand: string): BrandEntry | null {
  const key = normalizeBrandKey(brand)
  if (!key) return null

  for (const entry of BRANDS) {
    if (entry.aliases.some((alias) => normalizeBrandKey(alias) === key)) {
      return entry
    }
  }

  for (const entry of BRANDS) {
    const hit = entry.aliases.some((alias) => {
      const aliasKey = normalizeBrandKey(alias)
      // 别名的拉丁字母/汉字太短时容易误判（比如品牌名里恰好带 "D"），跳过
      return aliasKey.length >= 2 && key.includes(aliasKey)
    })
    if (hit) return entry
  }

  return null
}

/** 预置一组在浅色和深色主题下都耐看的色相，保证每个品牌颜色稳定且不刺眼 */
const BRAND_HUES = [8, 20, 34, 45, 152, 172, 196, 214, 244, 268, 292, 324]

function hashSeed(seed: string): number {
  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100000
  }
  return hash
}

/**
 * 没有 Logo 素材时显示的品牌缩写（需求里的「品牌名称或品牌缩写」）。
 * 汉字取首字（达亿瓦 → 达），拉丁名取缩写：名字本身很短就整个用（DUO、YGK），
 * 较长则取前两个字母（Shimano → SH）。64px 的框放得下 1~4 个字符，字号统一。
 */
function brandLabel(value: string): string {
  // 用展开而不是 [0]，避免把 emoji 等代理对拆成半个字符
  const [first = ''] = [...value]
  if (!/[a-z]/i.test(first)) return first

  const latin = value.match(/[a-z]+/i)?.[0] ?? ''
  return (latin.length <= 4 ? latin : latin.slice(0, 2)).toUpperCase()
}

export interface BrandTileModel {
  /** 文字 Logo 的缩写（1~4 个字符），品牌为空时是空字符串 */
  label: string
  /** 计算出的色相，交给 CSS 变量上色 */
  hue: number
  /** 悬浮提示与读屏用的完整品牌名 */
  title: string
  /** 命中的品牌 Logo 素材，未配置时是 null（界面用文字 Logo） */
  logo: BrandLogoAsset | null
  /** 是否识别出了具体品牌 */
  matched: boolean
}

/**
 * 把装备的 brand 字段解析成品牌标记的展示数据。
 * 识别不到品牌或品牌为空时也有结果，界面照常渲染文字/占位标记。
 */
export function resolveBrandTile(brand: string): BrandTileModel {
  const entry = findBrand(brand)
  const display = entry?.name ?? brand.trim()

  // 同一个品牌用同一个种子 → 中英文写法颜色一致；没收录的品牌按名称稳定取色
  const seed = entry?.id ?? display.toLowerCase()

  return {
    label: brandLabel(display),
    hue: BRAND_HUES[hashSeed(seed) % BRAND_HUES.length],
    title: display,
    logo: entry?.logo ?? null,
    matched: entry !== null,
  }
}

/**
 * 品牌选择器里中文名旁边显示的英文名：aliases 里第一个含拉丁字母的写法
 * （写成「禧玛诺 Shimano」）。品牌名称本身就是英文时返回 null，
 * 免得显示成「Megabass Megabass」。
 */
export function brandLatinName(entry: BrandEntry): string | null {
  if (/[a-z]/i.test(entry.name)) return null
  return entry.aliases.find((alias) => /[a-z]/i.test(alias)) ?? null
}

export interface BrandSuggestion {
  entry: BrandEntry
  /** 中文名旁边显示的英文名，没有时为 null */
  latin: string | null
}

/**
 * 按关键字搜品牌，给装备表单的品牌选择框用。
 * 忽略大小写和空格（复用上面那套 normalizeBrandKey），中英文和别名都能搜到：
 * 「钓」能搜出钓之猪 / 钓迷 / 钓之屋，「shim」能搜出禧玛诺。
 *
 * 排序：「以关键字开头」优先于「只是包含关键字」，同一档次内保持品牌库里的登记顺序
 * （重点品牌排前面）。Array.sort 是稳定排序，所以同档次不会被打乱。
 */
export function searchBrands(query: string, limit = 8): BrandSuggestion[] {
  const key = normalizeBrandKey(query)
  if (!key) return []

  const ranked: { entry: BrandEntry; rank: number }[] = []

  for (const entry of BRANDS) {
    const nameKey = normalizeBrandKey(entry.name)
    let rank = -1
    if (nameKey.startsWith(key)) rank = 0
    else if (nameKey.includes(key)) rank = 1
    else if (entry.aliases.some((a) => normalizeBrandKey(a).startsWith(key))) rank = 2
    else if (entry.aliases.some((a) => normalizeBrandKey(a).includes(key))) rank = 3

    if (rank >= 0) ranked.push({ entry, rank })
  }

  ranked.sort((a, b) => a.rank - b.rank)

  return ranked.slice(0, limit).map(({ entry }) => ({
    entry,
    latin: brandLatinName(entry),
  }))
}
