import { useMemo, useState } from 'react'
import CatchCard from '../components/CatchCard'
import TopBar from '../components/TopBar'
import {
  CloseIcon,
  FilterIcon,
  FishIcon,
  LayersIcon,
  PlayIcon,
  RulerIcon,
  SearchIcon,
  SortIcon,
  WeightIcon,
} from '../components/icons'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useNow } from '../hooks/useNow'
import {
  EMPTY_QUERY,
  RANGE_LABELS,
  SORT_LABELS,
  buildFacets,
  filterCatches,
  isQueryActive,
  sortCatches,
  summarizeCatches,
  type CatchQuery,
  type CatchSortKey,
  type CatchTimeRange,
} from '../lib/catchFilter'
import { formatDateCN, formatLength, formatWeight } from '../lib/tripFormat'
import type { CatchPhotoLibraryApi } from '../hooks/useCatchPhotos'
import type { TripApi } from '../hooks/useTrip'
import './CatchArchivePage.css'

/**
 * 我的渔获：所有出勤里记过的渔获，一个不落地汇总在一起。
 *
 * 数据全部来自 `trip.catches`（和出勤详情页是同一份），这里**不新建任何存储**，
 * 也不复制记录 —— 所以在这里改一条，出勤详情里看到的立刻是同一条。
 * 照片走的还是渔获照片那套 IndexedDB（`useCatchPhotos` 签发的 object URL）。
 */

interface CatchArchivePageProps {
  trip: TripApi
  catchPhotos: CatchPhotoLibraryApi
  onBack: () => void
  onOpenCatch: (catchId: string) => void
  /** 空状态里的「开始出勤」 */
  onStartTrip: () => void
  /** 正在出勤时空状态里改显示「返回出勤」 */
  onResumeTrip: () => void
}

const SORT_KEYS: CatchSortKey[] = ['newest', 'oldest', 'length', 'weight']
const RANGE_KEYS: CatchTimeRange[] = ['all', '7d', '30d', 'year']

export default function CatchArchivePage({
  trip,
  catchPhotos,
  onBack,
  onOpenCatch,
  onStartTrip,
  onResumeTrip,
}: CatchArchivePageProps) {
  // 时间范围与「今天」的判断都需要当前时间，渲染里不直接读时钟
  const now = useNow(60_000)

  const [query, setQuery] = useState<CatchQuery>(EMPTY_QUERY)
  const [sortKey, setSortKey] = useState<CatchSortKey>('newest')
  const [filterOpen, setFilterOpen] = useState(false)
  // 输入框跟着手指走，真正用于筛选的是停下来之后的那个值
  const debouncedKeyword = useDebouncedValue(query.keyword, 200)

  const stats = useMemo(() => summarizeCatches(trip.catches), [trip.catches])

  // 这两个查询函数自身是 useCallback（依赖 sessions / spots），
  // 数据一变它们就变，筛选与统计也就跟着重算
  const { spotById, sessionById } = trip
  const sources = useMemo(
    () => ({
      spotNameOf: (spotId: string) => spotById(spotId)?.name ?? null,
      sessionLabelOf: (sessionId: string) => {
        const session = sessionById(sessionId)
        if (!session) return null
        return `${formatDateCN(session.startedAt)}${session.spotName ? ` · ${session.spotName}` : ''}`
      },
    }),
    [spotById, sessionById],
  )

  const facets = useMemo(
    () => buildFacets(trip.catches, sources),
    [trip.catches, sources],
  )

  const effectiveQuery = useMemo<CatchQuery>(
    () => ({ ...query, keyword: debouncedKeyword }),
    [query, debouncedKeyword],
  )

  const visible = useMemo(
    () => sortCatches(filterCatches(trip.catches, effectiveQuery, { ...sources, now }), sortKey),
    [trip.catches, effectiveQuery, sources, now, sortKey],
  )

  const filtered = isQueryActive(effectiveQuery)
  const hasAnyCatch = trip.catches.length > 0
  const activeSession = trip.activeSession

  function updateQuery(patch: Partial<CatchQuery>) {
    setQuery((current) => ({ ...current, ...patch }))
  }

  function clearQuery() {
    setQuery(EMPTY_QUERY)
  }

  const statItems = [
    { key: 'count', label: '累计渔获', value: String(stats.count), Icon: FishIcon },
    {
      key: 'species',
      label: '鱼种数量',
      // 一条都没填鱼种时显示「—」，不写 0：0 种和「没填」不是一回事
      value: stats.speciesCount > 0 ? String(stats.speciesCount) : '—',
      Icon: LayersIcon,
    },
    {
      key: 'length',
      label: '最大长度',
      value: stats.maxLengthCm !== null ? formatLength(stats.maxLengthCm) : '—',
      Icon: RulerIcon,
    },
    {
      key: 'weight',
      label: '最大重量',
      value: stats.maxWeightG !== null ? formatWeight(stats.maxWeightG) : '—',
      Icon: WeightIcon,
    },
  ]

  return (
    <div className="catch-archive">
      <TopBar title="我的渔获" subtitle="记录每一次精彩上鱼" onBack={onBack} backLabel="返回我的" />

      <section className="catch-archive__stats" aria-label="渔获统计">
        {statItems.map(({ key, label, value, Icon }) => (
          <div className="catch-archive__stat" key={key}>
            <span className="catch-archive__stat-icon" aria-hidden="true">
              <Icon size={14} />
            </span>
            <strong>{value}</strong>
            <span className="catch-archive__stat-label">{label}</span>
          </div>
        ))}
      </section>

      {hasAnyCatch && (
        <>
          <div className="catch-archive__toolbar">
            <div className="catch-archive__search">
              <SearchIcon size={16} />
              <input
                className="catch-archive__input"
                type="search"
                value={query.keyword}
                placeholder="搜鱼种、钓点或备注"
                onChange={(event) => updateQuery({ keyword: event.target.value })}
                aria-label="搜索渔获"
              />
              {query.keyword && (
                <button
                  type="button"
                  className="catch-archive__clear"
                  onClick={() => updateQuery({ keyword: '' })}
                  aria-label="清空搜索"
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              className={`catch-archive__filter${
                filterOpen ? ' catch-archive__filter--open' : ''
              }${filtered ? ' catch-archive__filter--on' : ''}`}
              onClick={() => setFilterOpen((open) => !open)}
              aria-expanded={filterOpen}
            >
              <FilterIcon size={16} />
              筛选
            </button>
          </div>

          <div className="chip-row" role="group" aria-label="排序方式">
            <span className="chip-row__label">
              <SortIcon size={13} />
            </span>
            {SORT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`chip${sortKey === key ? ' chip--on' : ''}`}
                onClick={() => setSortKey(key)}
                aria-pressed={sortKey === key}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>

          {filterOpen && (
            <div className="catch-archive__filters">
              <FilterGroup
                title="鱼种"
                options={facets.species}
                value={query.species}
                onPick={(value) => updateQuery({ species: value })}
              />
              <FilterGroup
                title="钓点"
                options={facets.spots}
                value={query.spotId}
                onPick={(value) => updateQuery({ spotId: value })}
              />
              <FilterGroup
                title="关联出勤"
                options={facets.sessions}
                value={query.sessionId}
                onPick={(value) => updateQuery({ sessionId: value })}
              />

              <div className="filter-group">
                <p className="filter-group__title">时间范围</p>
                <div className="chip-row">
                  {RANGE_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`chip${query.range === key ? ' chip--on' : ''}`}
                      onClick={() => updateQuery({ range: key })}
                      aria-pressed={query.range === key}
                    >
                      {RANGE_LABELS[key]}
                    </button>
                  ))}
                </div>
              </div>

              {filtered && (
                <button type="button" className="catch-archive__reset" onClick={clearQuery}>
                  清除筛选
                </button>
              )}
            </div>
          )}

          {filtered && (
            <p className="catch-archive__count">
              筛选后 {visible.length} 条 / 共 {stats.count} 条
            </p>
          )}
        </>
      )}

      {!hasAnyCatch ? (
        <div className="catch-archive__empty">
          <span className="catch-archive__empty-icon" aria-hidden="true">
            <FishIcon size={30} />
          </span>
          <p className="catch-archive__empty-title">还没有记录渔获</p>
          <p className="catch-archive__empty-hint">下一次精彩上鱼，从这里开始记录。</p>
          <button
            type="button"
            className="catch-archive__empty-action"
            onClick={activeSession ? onResumeTrip : onStartTrip}
          >
            <PlayIcon size={16} />
            {activeSession ? '返回出勤' : '开始出勤'}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="catch-archive__empty">
          <p className="catch-archive__empty-title">没有找到符合条件的渔获</p>
          <p className="catch-archive__empty-hint">
            换个关键词或者放宽筛选条件试试，历史记录都还在。
          </p>
          <button type="button" className="catch-archive__empty-action" onClick={clearQuery}>
            清除筛选
          </button>
        </div>
      ) : (
        <ul className="catch-grid">
          {visible.map((record) => (
            <li key={record.id}>
              <CatchCard
                record={record}
                photoUrl={catchPhotos.photos[record.id]?.url ?? null}
                spotName={record.spotId ? (sources.spotNameOf(record.spotId) ?? '标点已删除') : null}
                onOpen={onOpenCatch}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------ 一组筛选项 ------------------------------ */

interface FilterGroupProps {
  title: string
  options: { value: string; label: string; count: number }[]
  value: string | null
  onPick: (value: string | null) => void
}

function FilterGroup({ title, options, value, onPick }: FilterGroupProps) {
  // 一个可选项都没有的维度不显示：不要摆一排点了也没用的按钮
  if (options.length === 0) return null

  return (
    <div className="filter-group">
      <p className="filter-group__title">{title}</p>
      <div className="chip-row">
        <button
          type="button"
          className={`chip${value === null ? ' chip--on' : ''}`}
          onClick={() => onPick(null)}
          aria-pressed={value === null}
        >
          全部
        </button>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`chip${value === option.value ? ' chip--on' : ''}`}
            onClick={() => onPick(option.value)}
            aria-pressed={value === option.value}
          >
            {option.label}
            <span className="chip__count">{option.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
