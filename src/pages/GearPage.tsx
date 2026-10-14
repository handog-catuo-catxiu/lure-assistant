import { useMemo, useState } from 'react'
import CategoryCard from '../components/CategoryCard'
import ConfirmDialog from '../components/ConfirmDialog'
import GearDetailModal from '../components/GearDetailModal'
import GearFormModal, { type GearImageChange } from '../components/GearFormModal'
import GearListItem from '../components/GearListItem'
import Header from '../components/Header'
import SearchBar from '../components/SearchBar'
import Toast from '../components/Toast'
import { BoxIcon, PlusIcon, SearchIcon } from '../components/icons'
import { useGear } from '../hooks/useGear'
import { useImageLibrary } from '../hooks/useImageLibrary'
import { useToast } from '../hooks/useToast'
import { gearMatchesQuery } from '../lib/gearSearch'
import { toImageErrorMessage } from '../lib/imageStore'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  type GearCategory,
  type GearDraft,
  type GearItem,
} from '../types/gear'
import './GearPage.css'

type Filter = GearCategory | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  ...CATEGORY_ORDER.map((key) => ({
    key: key as Filter,
    label: CATEGORY_META[key].label,
  })),
]

export default function GearPage() {
  const {
    items,
    addGear,
    updateGear,
    removeGear,
    toggleFavorite,
    setShowImageOnHome,
  } = useGear()
  const { images, saveImage, removeImage } = useImageLibrary()
  const { message, showToast } = useToast()

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<GearItem | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GearItem | null>(null)

  /** 分类数量与总数都从 items 实时推导；分类列表直接取 CATEGORY_ORDER，新增分类不用改这里 */
  const counts = useMemo(() => {
    const result = Object.fromEntries(
      CATEGORY_ORDER.map((category) => [category, 0]),
    ) as Record<GearCategory, number>
    for (const item of items) result[item.category] += 1
    return result
  }, [items])

  const favoriteCount = useMemo(
    () => items.filter((item) => item.favorite).length,
    [items],
  )

  /** 分类筛选与搜索关键词同时生效 */
  const visibleGear = useMemo(
    () =>
      items.filter((item) => {
        if (filter !== 'all' && item.category !== filter) return false
        return gearMatchesQuery(item, query)
      }),
    [items, filter, query],
  )

  /** 从 items 里查当前详情，编辑保存后自动显示最新数据 */
  const detailItem = useMemo(
    () => items.find((item) => item.id === detailId) ?? null,
    [items, detailId],
  )

  const isSearching = query.trim().length > 0
  const isFiltering = isSearching || filter !== 'all'

  /** 点击分类卡片：再点一次取消筛选，回到全部 */
  function handleSelectCategory(category: GearCategory) {
    setFilter((current) => (current === category ? 'all' : category))
  }

  function handleResetFilters() {
    setQuery('')
    setFilter('all')
  }

  function handleOpenAdd() {
    setEditing(null)
    setFormOpen(true)
  }

  function handleOpenEdit(item: GearItem) {
    setEditing(item)
    setFormOpen(true)
  }

  /**
   * 图片改动在表单里只是暂存，保存时才写进 IndexedDB：
   * 装备文字数据先落库，图片失败也不会影响装备本身。
   */
  function applyImageChange(gearId: string, change: GearImageChange) {
    if (change.file) {
      saveImage(gearId, change.file).catch((err) => {
        showToast(toImageErrorMessage(err))
      })
      return
    }
    if (change.remove) {
      removeImage(gearId).catch((err) => {
        showToast(toImageErrorMessage(err))
      })
    }
  }

  function handleSubmit(draft: GearDraft, imageChange: GearImageChange) {
    const gearId = editing ? editing.id : addGear(draft).id

    if (editing) {
      updateGear(editing.id, draft)
      showToast(`已更新「${draft.name}」`)
    } else {
      showToast(`已添加「${draft.name}」`)
    }

    setFormOpen(false)
    setEditing(null)
    applyImageChange(gearId, imageChange)
  }

  /** 取消编辑时回到详情（如果是从详情进来的） */
  function handleCancelForm() {
    setFormOpen(false)
    setEditing(null)
  }

  function handleConfirmDelete() {
    const target = pendingDelete
    if (!target) return

    removeGear(target.id)
    setDetailId(null)
    setPendingDelete(null)
    showToast(`已删除「${target.name}」`)

    // 装备没了，对应照片也没必要留着（同时清掉未来可能存在的 AI 图）
    removeImage(target.id).catch(() => {
      showToast('装备已删除，但照片清理失败')
    })
  }

  return (
    <div className="gear-page">
      <Header total={items.length} favoriteCount={favoriteCount} />

      <section className="gear-page__section">
        <h2 className="gear-page__heading">装备分类</h2>
        <div className="gear-page__categories">
          {CATEGORY_ORDER.map((category) => (
            <CategoryCard
              key={category}
              category={category}
              count={counts[category]}
              active={filter === category}
              onSelect={handleSelectCategory}
            />
          ))}
        </div>
      </section>

      <section className="gear-page__section">
        <button type="button" className="add-button" onClick={handleOpenAdd}>
          <PlusIcon size={20} />
          添加装备
        </button>
      </section>

      <section className="gear-page__section">
        <div className="gear-page__list-head">
          <h2 className="gear-page__heading">我的装备</h2>
          <span className="gear-page__count">
            {isFiltering ? `筛选出 ${visibleGear.length} 件` : `共 ${visibleGear.length} 件`}
          </span>
        </div>

        {items.length > 0 && (
          <>
            <SearchBar value={query} onChange={setQuery} />

            <div className="gear-page__filters">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  className={`chip${filter === key ? ' chip--active' : ''}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {visibleGear.length > 0 ? (
          <ul className="gear-page__list">
            {visibleGear.map((item) => (
              <GearListItem
                key={item.id}
                item={item}
                userImageUrl={images[item.id]?.url ?? null}
                onOpen={(target) => setDetailId(target.id)}
                onEdit={handleOpenEdit}
                onDelete={setPendingDelete}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </ul>
        ) : (
          <div className="gear-page__empty">
            <span className="gear-page__empty-icon">
              {items.length === 0 ? (
                <BoxIcon size={22} />
              ) : (
                <SearchIcon size={22} />
              )}
            </span>

            {items.length === 0 ? (
              <p className="gear-page__empty-text">
                还没有装备，点上面「添加装备」记录第一件吧
              </p>
            ) : (
              <>
                <p className="gear-page__empty-text">
                  {isSearching
                    ? `没有找到与「${query.trim()}」匹配的装备`
                    : '该分类下还没有装备'}
                </p>
                <p className="gear-page__empty-hint">
                  {isSearching
                    ? '试试换个关键词，或切换分类筛选'
                    : '换个分类看看，或添加一件新装备'}
                </p>
                <button
                  type="button"
                  className="gear-page__empty-btn"
                  onClick={handleResetFilters}
                >
                  清除筛选条件
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {/* 同一时间只挂载一个弹窗，避免多层遮罩互相干扰 */}
      {detailItem && !formOpen && !pendingDelete && (
        <GearDetailModal
          item={detailItem}
          userImageUrl={images[detailItem.id]?.url ?? null}
          onClose={() => setDetailId(null)}
          onEdit={handleOpenEdit}
          onDelete={setPendingDelete}
          onToggleFavorite={toggleFavorite}
          onToggleShowImageOnHome={setShowImageOnHome}
        />
      )}

      {formOpen && (
        <GearFormModal
          initial={editing}
          defaultCategory={filter === 'all' ? 'rod' : filter}
          currentImageUrl={editing ? images[editing.id]?.url ?? null : null}
          onCancel={handleCancelForm}
          onSubmit={handleSubmit}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除装备"
          message="确定要删除这件装备吗？"
          highlight={`${pendingDelete.name}（${CATEGORY_META[pendingDelete.category].label}）`}
          confirmText="删除"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <Toast message={message} />
    </div>
  )
}
