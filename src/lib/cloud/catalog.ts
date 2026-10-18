/**
 * 官方装备图鉴的云端读取。
 *
 * 官方图鉴单独存在 catalog_* 表里，所有用户共享、只读；它和用户的个人装备
 * （user_gears）是两份数据，不会把官方产品复制进每个账号。
 *
 * 查询走服务端分页 + 分类筛选 + 关键词搜索，不会一次下载整本图鉴。
 * 浏览过的产品元数据会缓存在 localStorage，离线时还能显示已看过的型号；
 * 从未配置云端或云端暂时不可用时，界面退回内置示例并明确标注「示例」。
 */
import { CATALOG } from '../../data/catalog'
import type { CatalogProduct } from '../../types/catalog'
import type { GearCategory, GearSpec } from '../../types/gear'
import { catalogMatchesQuery } from '../gearSearch'
import {
  catalogBucket,
  cloudErrorMessage,
  getRdb,
  getStorage,
  isCloudDataConfigured,
  isOffline,
} from './client'

export interface CatalogGearRow {
  id: string
  brand_id?: string | null
  brand_name?: string | null
  series_name?: string | null
  category?: string | null
  model?: string | null
  name?: string | null
  spec?: unknown
  description?: string | null
  image_path?: string | null
  image_url?: string | null
  image_credit?: string | null
  image_license?: string | null
  official_source?: string | null
  status?: string | null
}

export type CatalogSource = 'cloud' | 'sample'

export interface CatalogPage {
  items: CatalogProduct[]
  total: number
  hasMore: boolean
  source: CatalogSource
  /** 云端读取失败时的说明；成功时为 null */
  error: string | null
}

export interface CatalogQuery {
  query?: string
  category?: GearCategory | 'all'
  offset?: number
  limit?: number
}

const CATEGORY_VALUES: GearCategory[] = ['rod', 'reel', 'lure', 'accessory']
const DEFAULT_LIMIT = 24

function asCategory(value: unknown): GearCategory | null {
  return CATEGORY_VALUES.includes(value as GearCategory)
    ? (value as GearCategory)
    : null
}

function normalizeSpec(value: unknown): GearSpec {
  if (typeof value !== 'object' || value === null) return {}
  const source = value as Record<string, unknown>
  const spec: GearSpec = {}
  for (const key of ['length', 'action', 'model', 'ratio', 'lureType', 'weight', 'accessoryType'] as const) {
    const raw = source[key]
    if (typeof raw === 'string' && raw.trim()) spec[key] = raw
  }
  return spec
}

async function rowImageUrl(row: CatalogGearRow): Promise<string | null> {
  if (row.image_url?.trim()) return row.image_url.trim()
  if (!row.image_path?.trim()) return null
  try {
    const storage = await getStorage()
    return storage.from(catalogBucket()).getPublicUrl(row.image_path.trim()).data.publicUrl
  } catch {
    return null
  }
}

async function mapRow(row: CatalogGearRow): Promise<CatalogProduct | null> {
  const category = asCategory(row.category)
  const name = (row.name ?? row.model ?? '').trim()
  if (!category || !name) return null

  const brand = (row.brand_name ?? '').trim()
  const imageUrl = await rowImageUrl(row)
  const credit = row.image_credit?.trim() || '厂商官方图片'
  const license = row.image_license?.trim() || '官方资料'

  return {
    id: row.id,
    brand,
    name,
    category,
    spec: normalizeSpec(row.spec),
    brandId: row.brand_id ?? undefined,
    series: row.series_name?.trim() || undefined,
    description: row.description?.trim() || undefined,
    imageUrl: imageUrl ?? undefined,
    officialSource: row.official_source?.trim() || undefined,
    status:
      row.status === 'discontinued' || row.status === 'hidden'
        ? row.status
        : 'active',
    photo: imageUrl
      ? {
          path: imageUrl,
          credit,
          license,
        }
      : undefined,
  }
}

/* ------------------------------ 本地缓存 ------------------------------ */

const CACHE_KEY = 'luremate:catalog-cache:v1'
const CACHE_LIMIT = 200
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14

interface CacheEntry {
  product: CatalogProduct
  cachedAt: number
}

interface CatalogCache {
  version: 1
  entries: Record<string, CacheEntry>
}

let memoryCache: CatalogCache | null = null

function loadCache(): CatalogCache {
  if (memoryCache) return memoryCache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      memoryCache = { version: 1, entries: {} }
      return memoryCache
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      memoryCache = { version: 1, entries: {} }
      return memoryCache
    }
    const entries: Record<string, CacheEntry> = {}
    const rawEntries = (parsed as { entries?: unknown }).entries
    if (typeof rawEntries === 'object' && rawEntries !== null) {
      for (const [id, value] of Object.entries(rawEntries)) {
        if (typeof value !== 'object' || value === null) continue
        const item = value as Record<string, unknown>
        if (typeof item.cachedAt !== 'number') continue
        const product = item.product as CatalogProduct | undefined
        if (product && typeof product.id === 'string') {
          entries[id] = { product, cachedAt: item.cachedAt }
        }
      }
    }
    memoryCache = { version: 1, entries }
    return memoryCache
  } catch {
    memoryCache = { version: 1, entries: {} }
    return memoryCache
  }
}

function saveCache(cache: CatalogCache): void {
  memoryCache = cache
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 缓存写不下不影响在线查询
  }
}

/** 记住浏览过的产品，最多 200 条，过期的自然淘汰 */
export function cacheCatalogProducts(products: CatalogProduct[]): void {
  if (products.length === 0) return
  const cache = loadCache()
  const now = Date.now()
  for (const product of products) {
    cache.entries[product.id] = { product, cachedAt: now }
  }

  const entries = Object.entries(cache.entries).sort(
    (a, b) => b[1].cachedAt - a[1].cachedAt,
  )
  if (entries.length > CACHE_LIMIT) {
    cache.entries = Object.fromEntries(entries.slice(0, CACHE_LIMIT))
  }
  saveCache(cache)
}

const SAMPLE_BY_ID = new Map(CATALOG.map((product) => [product.id, product]))

/**
 * 同步查一个产品：先看浏览缓存，再看内置示例。
 * 用于装备详情页/表单在渲染时立刻拿到图片和规格，不阻塞界面。
 */
export function findCachedCatalogProduct(
  catalogId: string | undefined | null,
): CatalogProduct | null {
  if (!catalogId) return null
  const cached = loadCache().entries[catalogId]
  if (cached && Date.now() - cached.cachedAt <= CACHE_TTL_MS) {
    return cached.product
  }
  return SAMPLE_BY_ID.get(catalogId) ?? null
}

/** 按 id 取产品：缓存没有再请求云端一次，失败时返回 null */
export async function fetchCatalogProduct(
  catalogId: string,
  options: { allowSample?: boolean } = {},
): Promise<CatalogProduct | null> {
  const cached = findCachedCatalogProduct(catalogId)
  if (cached) return cached
  if (isOffline() || !isCloudDataConfigured()) {
    return options.allowSample === false ? null : SAMPLE_BY_ID.get(catalogId) ?? null
  }

  try {
    const rdb = await getRdb()
    const response = await rdb
      .from<CatalogGearRow>('catalog_gear')
      .select('*')
      .eq('id', catalogId)
      .limit(1)
    if (response.error) throw response.error
    const row = response.data?.[0]
    if (!row) return options.allowSample === false ? null : SAMPLE_BY_ID.get(catalogId) ?? null
    const product = await mapRow(row)
    if (product) cacheCatalogProducts([product])
    return product
  } catch {
    return options.allowSample === false ? null : SAMPLE_BY_ID.get(catalogId) ?? null
  }
}

/* ------------------------------ 云端查询 ------------------------------ */

function sanitizeKeyword(value: string): string {
  // 去掉会破坏 PostgREST 过滤语法的字符；普通中文/英文/数字原样保留
  return value.replace(/[%_,()*]/g, ' ').trim()
}

function samplePage(query: CatalogQuery): CatalogPage {
  const category = query.category ?? 'all'
  const keyword = query.query?.trim() ?? ''
  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, query.limit ?? DEFAULT_LIMIT)

  const matched = CATALOG.filter(
    (product) =>
      (category === 'all' || product.category === category) &&
      (!keyword || catalogMatchesQuery(product, keyword)),
  )
  return {
    items: matched.slice(offset, offset + limit),
    total: matched.length,
    hasMore: offset + limit < matched.length,
    source: 'sample',
    error: null,
  }
}

/**
 * 查询一页官方图鉴。
 *
 * 任何失败都不会让页面白屏：返回内置示例并带上 error 文案，
 * 由界面说明「当前显示的是内置示例，不是云端官方数据」。
 */
export async function fetchCatalogPage(query: CatalogQuery): Promise<CatalogPage> {
  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.max(1, Math.min(100, query.limit ?? DEFAULT_LIMIT))
  const keyword = query.query?.trim() ?? ''
  const category = query.category ?? 'all'

  if (isOffline()) {
    return {
      ...samplePage(query),
      error: '当前网络不可用，先显示内置示例；联网后会查询云端官方图鉴',
    }
  }

  if (!isCloudDataConfigured()) {
    return {
      ...samplePage(query),
      error: '云端官方图鉴还没有启用，当前显示内置示例；配置云端后会自动查询正式数据',
    }
  }

  try {
    const rdb = await getRdb()
    let builder = rdb
      .from<CatalogGearRow>('catalog_gear')
      .select('*', { count: 'exact' })
      .eq('status', 'active')

    if (category !== 'all') builder = builder.eq('category', category)
    for (const word of keyword.split(/\s+/).map(sanitizeKeyword).filter(Boolean)) {
      builder = builder.ilike('search_text', `%${word}%`)
    }

    const response = await builder
      .order('sort_order', { ascending: true })
      .order('brand_name', { ascending: true })
      .order('model', { ascending: true })
      .range(offset, offset + limit - 1)

    if (response.error) throw response.error

    const rows = response.data ?? []
    const mapped = await Promise.all(rows.map(mapRow))
    const items = mapped.filter((product): product is CatalogProduct => product !== null)
    cacheCatalogProducts(items)

    const total = response.count ?? items.length

    // 云端配置成功但还没有正式数据时，明确说明并退回内置示例
    if (total === 0 && offset === 0 && !keyword && category === 'all') {
      return {
        ...samplePage(query),
        error: '云端官方图鉴还没有录入正式产品，当前显示内置示例',
      }
    }

    return {
      items,
      total,
      hasMore: offset + items.length < total,
      source: 'cloud',
      error: null,
    }
  } catch (error) {
    return {
      ...samplePage(query),
      error: cloudErrorMessage(error),
    }
  }
}
