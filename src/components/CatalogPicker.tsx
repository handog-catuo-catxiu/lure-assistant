import { useMemo, useState } from 'react'
import { CATALOG } from '../data/catalog'
import { catalogMatchesQuery } from '../lib/gearSearch'
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

interface CatalogPickerProps {
  open: boolean
  /** 表单当前分类，同分类的产品排在前面 */
  currentCategory: GearCategory
  /** 已选中的图鉴产品 */
  selectedId?: string
  onToggle: () => void
  onSelect: (product: CatalogProduct) => void
}

export default function CatalogPicker({
  open,
  currentCategory,
  selectedId,
  onToggle,
  onSelect,
}: CatalogPickerProps) {
  const [query, setQuery] = useState('')
  // 默认「全部」：和加入筛选条之前一样，列出所有产品、当前分类排前面
  const [filter, setFilter] = useState<CatalogFilter>('all')

  const results = useMemo(() => {
    const matched = CATALOG.filter(
      (product) =>
        (filter === 'all' || product.category === filter) &&
        catalogMatchesQuery(product, query),
    )
    // 与表单当前分类一致的产品优先，方便快速选择
    return matched.sort((a, b) => {
      const weightA = a.category === currentCategory ? 0 : 1
      const weightB = b.category === currentCategory ? 0 : 1
      return weightA - weightB
    })
  }, [query, currentCategory, filter])

  return (
    <div className="catalog-picker">
      <button
        type="button"
        className="catalog-picker__toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="catalog-picker__toggle-icon" aria-hidden="true">
          📖
        </span>
        <span className="catalog-picker__toggle-text">
          {selectedId ? '已填入图鉴产品，可重新选择' : '从装备图鉴选择'}
          <em>自动填好品牌 / 型号 / 规格</em>
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
              onChange={(event) => setQuery(event.target.value)}
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
                onClick={() => setFilter(key)}
              >
                {key === 'all' ? '全部' : CATEGORY_META[key].label}
              </button>
            ))}
          </div>

          {results.length > 0 ? (
            <ul className="catalog-picker__list">
              {results.map((product) => {
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
                          {formatSpec(product.category, product.spec)}
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
          ) : (
            <p className="catalog-picker__empty">
              图鉴里没有匹配的产品，下面的信息可以手动填写
            </p>
          )}

          <p className="catalog-picker__note">
            图鉴目前只有示例数据，左侧显示品牌标记；没有素材的品牌用文字占位
          </p>
        </div>
      )}
    </div>
  )
}
