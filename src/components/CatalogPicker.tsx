import { useEffect, useRef, useState } from 'react'
import { fetchCatalogPage } from '../lib/cloud/catalog'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  formatSpec,
  type GearCategory,
} from '../types/gear'
import type { CatalogProduct } from '../types/catalog'
import BrandTile from './BrandTile'
import { SearchIcon } from './icons'
import './CatalogPicker.css'

type CatalogFilter = GearCategory | 'all'

const PAGE_SIZE = 24

interface CatalogPickerProps {
  open: boolean
  /** 表单当前分类，同分类的产品排在前面 */
  currentCategory: GearCategory
  /** 已选中的图鉴产品 */
  selectedId?: string
  onToggle: () => void
  onSelect: (product: CatalogProduct) => void
}

/**
 * 装备图鉴选择器。
 *
 * 数据来自 CloudBase 官方图鉴表（服务端分页 + 搜索 + 分类筛选），
 * 每次只取一页；云端不可用时退回内置示例并明确标注，不把示例冒充官方数据。
 */
export default function CatalogPicker({
  open,
  currentCategory,
  selectedId,
  onToggle,
  onSelect,
}: CatalogPickerProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [items, setItems] = useState<CatalogProduct[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'cloud' | 'sample'>('sample')

  const debouncedQuery = useDebouncedValue(query, 280)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!open) return

    const requestId = ++requestRef.current
    let cancelled = false

    async function load() {
      const result = await fetchCatalogPage({
        query: debouncedQuery,
        category: filter,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      if (cancelled || requestId !== requestRef.current) return

      // 当前分类排前面，和旧版体验一致；服务端已经按品牌/型号排好序
      const sorted = result.items.slice().sort((a, b) => {
        const weightA = a.category === currentCategory ? 0 : 1
        const weightB = b.category === currentCategory ? 0 : 1
        return weightA - weightB
      })

      setItems((previous) => (page === 0 ? sorted : [...previous, ...sorted]))
      setTotal(result.total)
      setSource(result.source)
      setError(result.error)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, debouncedQuery, filter, page, currentCategory])

  function handleQueryChange(value: string) {
    setQuery(value)
    setPage(0)
    setItems([])
    setLoading(true)
    setError(null)
  }

  function handleFilterChange(next: CatalogFilter) {
    setFilter(next)
    setPage(0)
    setItems([])
    setLoading(true)
    setError(null)
  }

  function handleToggle() {
    if (!open) {
      setPage(0)
      setItems([])
      setLoading(true)
    }
    onToggle()
  }

  function handleLoadMore() {
    setPage((current) => current + 1)
    setLoading(true)
  }

  return (
    <div className="catalog-picker">
      <button
        type="button"
        className="catalog-picker__toggle"
        onClick={handleToggle}
        aria-expanded={open}
      >
        <span className="catalog-picker__toggle-icon" aria-hidden="true">
          📖
        </span>
        <span className="catalog-picker__toggle-text">
          {selectedId ? '已填入官方图鉴产品，可重新选择' : '从官方装备图鉴选择'}
          <em>公开资料 · 自动填好品牌 / 型号 / 规格</em>
        </span>
        <span className="catalog-picker__chevron" aria-hidden="true">
          {open ? '收起' : '展开'}
        </span>
      </button>

      {open && (
        <div className="catalog-picker__panel">
          <div className="catalog-picker__search">
            <SearchIcon size={16} className="catalog-picker__search-icon" />
            <input
              className="catalog-picker__input"
              type="text"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder="搜索品牌或型号，例如 月影 / NASCI"
              aria-label="搜索图鉴产品"
              autoComplete="off"
            />
          </div>

          {/* 分类筛选：分类多了以后光靠排序不够，可以只看某一类（含周边装备） */}
          <div className="catalog-picker__filters">
            {(['all', ...CATEGORY_ORDER] as CatalogFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`catalog-chip${
                  filter === key ? ' catalog-chip--active' : ''
                }`}
                aria-pressed={filter === key}
                onClick={() => handleFilterChange(key)}
              >
                {key === 'all' ? '全部' : CATEGORY_META[key].label}
              </button>
            ))}
          </div>

          {items.length > 0 ? (
            <ul className="catalog-picker__list">
              {items.map((product) => {
                const selected = product.id === selectedId
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      className={`catalog-item${selected ? ' catalog-item--selected' : ''}`}
                      onClick={() => onSelect(product)}
                      aria-pressed={selected}
                    >
                      {/* 与首页装备列表复用同一个品牌标记组件：同一套匹配逻辑和素材 */}
                      <BrandTile brand={product.brand} />
                      <span className="catalog-item__body">
                        <span className="catalog-item__name">
                          {product.brand} {product.name}
                        </span>
                        <span className="catalog-item__spec">
                          {[product.series, formatSpec(product.category, product.spec)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span
                        className="catalog-item__tag"
                        data-category={product.category}
                      >
                        {CATEGORY_META[product.category].label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : !loading ? (
            <p className="catalog-picker__empty">
              {query.trim()
                ? '图鉴里没有匹配的产品，下面的信息可以手动填写'
                : '图鉴暂时没有产品，下面的信息可以手动填写'}
            </p>
          ) : null}

          {loading && (
            <p className="catalog-picker__status" role="status">
              正在查询图鉴…
            </p>
          )}

          {!loading && items.length > 0 && (
            <div className="catalog-picker__footer">
              <span className="catalog-picker__status">
                已显示 {items.length} / {total} 个
              </span>
              {items.length < total && (
                <button
                  type="button"
                  className="catalog-picker__more"
                  onClick={handleLoadMore}
                >
                  加载更多
                </button>
              )}
            </div>
          )}

          <p className="catalog-picker__note">
            {source === 'cloud'
              ? '数据来自云端官方图鉴，所有用户共享，只有管理员能维护'
              : '当前显示的是内置示例，用于验证“选择产品 → 自动填充”的流程；正式收录前会按厂商资料核对'}
          </p>
          {error && (
            <p className="catalog-picker__warning" role="status">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
