import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Modal from './Modal'
import TripMap from './TripMap'
import { PinIcon } from './icons'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useLastFix } from '../hooks/useLastFix'
import { useNow } from '../hooks/useNow'
import { usePlaceName } from '../hooks/usePlaceName'
import { canUseAmapServices, describeAmapGap } from '../lib/amap/config'
import { searchPlaces, toGeocodeMessage } from '../lib/amap/geocode'
import { formatCoordinate, formatFixAge } from '../lib/geo'
import type { Coordinate } from '../lib/coord'
import type { PlaceHit } from '../lib/amap/geocode'
import './MapPicker.css'

/** 地名的查询延迟：手指停稳再查，别每点一下就发一次请求 */
const PLACE_QUERY_DELAY_MS = 700
/** 搜索命中之后镜头拉到的缩放级别 */
const FOCUS_ZOOM = 15

interface MapPickerProps {
  /** 打开时的初始位置：标点已有位置，或者手上的当前位置 */
  initial?: Coordinate | null
  /** 初始位置对应的地名，用来说明「现在这个点叫什么」 */
  initialName?: string | null
  onCancel: () => void
  /**
   * 确认选点。坐标是 **WGS84**（已经由地图组件从 GCJ-02 转过来了），
   * 可以直接存进标点；name 是这一带的地名，查不到就是空串。
   */
  onConfirm: (result: { latitude: number; longitude: number; name: string }) => void
}

/**
 * 在地图上选点 / 搜索地点。
 *
 * 两条路都通：
 * - 直接点地图上的位置（点一下就把标记放那儿）
 * - 搜索地名（水库、公园、路名都行），从结果里挑一个
 *
 * 地名只是**建议**：查不到就让用户自己在标点表单里写名字，
 * 绝不会拿一个猜出来的名字充数。
 */
export default function MapPicker({
  initial = null,
  initialName = null,
  onCancel,
  onConfirm,
}: MapPickerProps) {
  const [picked, setPicked] = useState<Coordinate | null>(initial)

  /*
   * 没有起点时，把镜头放到上次成功定位的附近，别一上来就是全国视野
   * （缩到全国再找自己那片水域，手机上要划半天）。
   * 这只是**镜头位置**，不是选中位置：用户没点地图，picked 就一直是空的。
   * 它是不是当前位置，下面的提示文字里也写明了。
   */
  const lastFix = useLastFix()
  const now = useNow(60_000)
  const initialView = initial ?? lastFix

  const [focus, setFocus] = useState<(Coordinate & { zoom?: number }) | null>(
    initial ? { ...initial, zoom: FOCUS_ZOOM } : null,
  )

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // 选点停下来之后再查地名，中途连点不会连发请求
  const settled = useDebouncedValue(picked, PLACE_QUERY_DELAY_MS)
  const place = usePlaceName(settled)

  /*
   * 交给地图的视角：优先用搜索命中 / 起点，都没有时用上次定位的位置。
   * 用「拆成数字再 memo」的写法，父组件重渲染不会造出新对象，
   * 否则地图每次渲染都会被重新定位一次，用户拖动就白拖了。
   */
  const targetLat = focus?.latitude ?? (picked ? null : (initialView?.latitude ?? null))
  const targetLng = focus?.longitude ?? (picked ? null : (initialView?.longitude ?? null))
  const targetZoom = focus?.zoom ?? FOCUS_ZOOM
  const viewFocus = useMemo(
    () =>
      targetLat === null || targetLng === null
        ? null
        : { latitude: targetLat, longitude: targetLng, zoom: targetZoom },
    [targetLat, targetLng, targetZoom],
  )

  const servicesReady = canUseAmapServices()
  const gap = describeAmapGap()
  const suggestedName = place.place?.name ?? ''
  /** 查不到新地名、但位置就是原来那个点时，沿用标点上已经存过的名字 */
  const fallbackName =
    picked && initial && samePoint(picked, initial) ? (initialName ?? '') : ''
  const displayName = suggestedName || fallbackName

  function handlePick(point: Coordinate) {
    setPicked(point)
    setSearchError(null)
  }

  function handlePickHit(hit: PlaceHit) {
    const next = { latitude: hit.latitude, longitude: hit.longitude }
    setPicked(next)
    // 搜索命中的点要主动把镜头拉过去，否则用户看不到它
    setFocus({ ...next, zoom: FOCUS_ZOOM })
    setHits([])
  }

  async function handleSearch() {
    const keyword = query.trim()
    if (!keyword || searching) return

    setSearching(true)
    setSearchError(null)
    try {
      // 已经选了点就按附近搜（更贴近「我要找这附近的水库」），否则全国搜
      const results = await searchPlaces({
        keyword,
        center: picked,
        radius: 50_000,
      })
      setHits(results)
      if (results.length === 0) setSearchError('没搜到这个地点，换个关键词试试。')
    } catch (error) {
      setHits([])
      setSearchError(toGeocodeMessage(error))
    } finally {
      setSearching(false)
    }
  }

  /*
   * 这个弹窗是叠在「新建 / 编辑标点」上面开的：挂到 body 上，
   * 免得被上层弹窗的层叠上下文和滚动容器裁掉半截。
   */
  return createPortal(
    <Modal
      title="在地图上选点"
      subtitle="点一下地图，或者搜索地名"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!picked}
            onClick={() => {
              if (!picked) return
              onConfirm({
                latitude: picked.latitude,
                longitude: picked.longitude,
                name: displayName,
              })
            }}
          >
            用这个位置
          </button>
        </>
      }
    >
      <div className="map-picker">
        <div className="map-picker__search">
          <input
            className="form__input map-picker__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSearch()
              }
            }}
            placeholder="搜索地点，例如 千岛湖、某某水库"
            autoComplete="off"
            disabled={!servicesReady}
          />
          <button
            type="button"
            className="map-picker__search-btn"
            onClick={() => void handleSearch()}
            disabled={!servicesReady || searching || !query.trim()}
          >
            {searching ? '搜索中…' : '搜索'}
          </button>
        </div>

        {!servicesReady && gap && <p className="map-picker__error">{gap}</p>}
        {searchError && <p className="map-picker__error">{searchError}</p>}

        {hits.length > 0 && (
          <ul className="map-picker__hits">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="map-picker__hit"
                  onClick={() => handlePickHit(hit)}
                >
                  <PinIcon size={15} />
                  <span className="map-picker__hit-body">
                    <span className="map-picker__hit-name">{hit.name}</span>
                    {hit.address && (
                      <span className="map-picker__hit-address">{hit.address}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <TripMap
          picked={picked}
          focus={viewFocus}
          onPick={handlePick}
          autoFit={false}
          height={280}
        />

        <div className="map-picker__status">
          {picked ? (
            <>
              <p className="map-picker__picked">
                已选中：{displayName || '这一带还没查到地名'}
              </p>
              <p className="map-picker__coords">
                {formatCoordinate(picked.latitude, picked.longitude)}
              </p>
              {place.status === 'loading' && (
                <p className="map-picker__hint">正在查这一带的地名…</p>
              )}
              {place.status === 'error' && place.error && (
                <p className="map-picker__hint">{place.error}</p>
              )}
              {place.status === 'empty' && (
                <p className="map-picker__hint">
                  这一带没有可用的地名，标点名称在下一步自己填就行。
                </p>
              )}
            </>
          ) : (
            <p className="map-picker__hint">
              还没选位置。点一下地图上你要去的地方。
              {!initial && lastFix
                ? `（地图先挪到上次定位的附近——那是 ${formatFixAge(
                    lastFix.recordedAt,
                    now,
                  )}，不是现在的位置）`
                : ''}
            </p>
          )}
        </div>
      </div>
    </Modal>,
    document.body,
  )
}

/** 判断两个点是不是同一个（用来决定要不要沿用原来的地名） */
function samePoint(a: Coordinate, b: Coordinate): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 1e-6 &&
    Math.abs(a.longitude - b.longitude) < 1e-6
  )
}
