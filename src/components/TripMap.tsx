import { useCallback, useEffect, useRef, useState } from 'react'
import { loadAmap, toAmapLoadMessage } from '../lib/amap/loader'
import { fromMapLngLat, toMapLngLat } from '../lib/coord'
import type { Coordinate } from '../lib/coord'
import { splitTrackSegments } from '../lib/geo'
import { formatClockSec, formatLength, formatWeight } from '../lib/tripFormat'
import { MapIcon } from './icons'
import type { CatchRecord, LiveGeoPoint, Spot, TrackPoint } from '../types/trip'
import './TripMap.css'

/**
 * 出勤地图：高德地图 JS API 2.0 底图 + 轨迹线 + 四类标记。
 *
 * ## 坐标系（很重要）
 *
 * 数据里存的坐标是 **WGS84**（手机 GPS 的原始值），高德地图要的是 **GCJ-02**。
 * 所有上地图的坐标都必须经过 `toMapLngLat()` 转换，本文件里没有第二处转换。
 * 地图上点出来的坐标则由 `fromMapLngLat()` 转回 WGS84 再交给调用方，
 * 因此「地图选点」和「GPS 定位」存下来的是同一套坐标系，不会互相偏移。
 *
 * ## 失败降级
 *
 * 没配 Key、脚本加载失败、断网 —— 都只是这块地图区域显示一句提示，
 * 出勤、渔获、装备、轨迹记录等功能完全不受影响。
 *
 * ## 视角规则
 *
 * 只在「第一次有数据」和用户主动点「全览」时自动定视角；
 * 之后 GPS 更新只在用户没有拖动过地图、且当前位置跑出画面时才平移过去。
 */

const TRACK_COLOR = '#0f7d8c'
const CURRENT_COLOR = '#1a73e8'

/** 自动定视角时的最大缩放：再近就看不到整条轨迹了 */
const FOCUS_ZOOM = 17

/** 底图风格：跟着应用的深色/浅色主题走，别在深色界面上糊一张雪白的图 */
const DARK_MAP_STYLE = 'amap://styles/dark'
const LIGHT_MAP_STYLE = 'amap://styles/normal'

function preferredMapStyle(): string {
  if (typeof window === 'undefined' || !window.matchMedia) return LIGHT_MAP_STYLE
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? DARK_MAP_STYLE
    : LIGHT_MAP_STYLE
}

/** 静态 SVG，不掺任何用户数据，直接当字符串用是安全的 */
const FISH_GLYPH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 12c2.5-4 7.3-5.2 11-3l5.2-2.6v11.2L14.4 15c-3.7 2.2-8.5 1-11-3Z" fill="currentColor"/><circle cx="7.9" cy="11.4" r="1" fill="#fff"/></svg>`

function hasCoords(value: {
  latitude?: number
  longitude?: number
}): value is { latitude: number; longitude: number } {
  return (
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude)
  )
}

/** 建一个只有 class 的 span，交给高德当标记图形 */
function createMarkerElement(className: string, html?: string): HTMLElement {
  const element = document.createElement('span')
  element.className = className
  if (html) element.innerHTML = html
  return element
}

/**
 * 弹窗内容用 DOM 拼，不用 innerHTML —— 标点名、鱼种这些是用户输入，
 * 拼字符串既容易出转义问题，也没必要。
 */
function createPopup(title: string, lines: string[]): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'trip-map__popup'

  const heading = document.createElement('strong')
  heading.textContent = title
  wrapper.appendChild(heading)

  for (const line of lines) {
    if (!line) continue
    const item = document.createElement('em')
    item.textContent = line
    wrapper.appendChild(item)
  }
  return wrapper
}

interface TripMapProps {
  /** 轨迹点，按时间升序；断点会自动断开，不会连成直线 */
  points?: TrackPoint[]
  /** 当前 GPS 位置（带来源：IP 大致位置会在图上单独标注） */
  current?: LiveGeoPoint | null
  /** 回放时的移动标记 */
  head?: TrackPoint | null
  /** 保存过位置的标点 */
  spots?: Spot[]
  /** 有位置的渔获 */
  catches?: CatchRecord[]
  /** 选点模式下已经选好的位置 */
  picked?: Coordinate | null
  /**
   * 把镜头挪到这里。搜索到某个地点、或从当前位置开始时用它；
   * 用户自己拖动地图不会改这个值，所以不会互相打架。
   */
  focus?: (Coordinate & { zoom?: number }) | null
  /** 传了就是「点地图选点」模式：点一下回调一次（回调里给的是 WGS84） */
  onPick?: (point: Coordinate) => void
  /**
   * 有了数据要不要自动把视角框到数据上。
   * 选点模式下关掉：用户刚点的地方不该被自动缩放打断。
   */
  autoFit?: boolean
  height?: number
  className?: string
  emptyText?: string
}

type MapPhase = 'loading' | 'ready' | 'failed'

export default function TripMap({
  points = [],
  current = null,
  head = null,
  spots = [],
  catches = [],
  picked = null,
  focus = null,
  onPick,
  autoFit = true,
  height = 240,
  className,
  emptyText = '还没有 GPS 数据，开始记录轨迹后这里会实时显示',
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMap.Map | null>(null)

  const [phase, setPhase] = useState<MapPhase>('loading')
  const [failure, setFailure] = useState<string | null>(null)
  /** 地图就绪的次数。它一变，下面所有画图的 effect 就重画一遍 */
  const [readyNonce, setReadyNonce] = useState(0)
  const [reloadNonce, setReloadNonce] = useState(0)

  /** 视角是否已经定过一次：定过之后就不再自动全览 */
  const fittedRef = useRef(false)
  /** 用户是否自己拖动/缩放过地图：拖过就不再自动跟随 */
  const userMovedRef = useRef(false)

  /** 点地图选点的回调放进 ref，避免因为父组件每次渲染换函数而反复解绑事件 */
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onPickRef.current = onPick
  }, [onPick])

  /** 一个共享的信息窗：点哪个标记就换成哪条内容，不在页面上堆一堆弹窗 */
  const infoWindowRef = useRef<AMap.InfoWindow | null>(null)

  /** 只碰 ref，所以身份稳定，可以安全地写进下面各 effect 的依赖里 */
  const openPopup = useCallback(
    (title: string, lines: string[], position: [number, number]) => {
      const map = mapRef.current
      const info = infoWindowRef.current
      if (!map || !info) return

      info.setContent(createPopup(title, lines))
      info.open(map, position)
    },
    [],
  )

  /**
   * 摘掉图上的覆盖物。图已经不在（或被换掉）时直接跳过。
   *
   * 高德的 `Map.remove()` 打在一个已经 `destroy()` 过的图上会直接抛错，而这个
   * 调用发生在 React 的清理函数里 —— 没有错误边界的整棵树会跟着一起卸载，
   * 表现就是切换页面后整页空白。所以「图还是不是这一张」必须在这里判一次。
   */
  const removeOverlays = useCallback((map: AMap.Map, overlays: unknown[]) => {
    if (overlays.length === 0 || mapRef.current !== map) return
    map.remove(overlays)
  }, [])

  /* ---------------------------- 地图初始化 ---------------------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let created: AMap.Map | null = null
    let observer: ResizeObserver | null = null
    // 主题监听要能在清理函数里摘掉，所以在 effect 作用域里先声明
    let theme: MediaQueryList | null = null
    let syncTheme: (() => void) | null = null

    loadAmap(reloadNonce > 0)
      .then((ns) => {
        // 组件已经卸载（或又点了一次重试）就不要再建地图了
        if (cancelled) return

        const map = new ns.Map(container, {
          viewMode: '2D',
          // 还没定位、也没有数据时先给一个全国视野，不假装用户在哪
          zoom: 4,
          center: [104.06, 35.68],
          resizeEnable: true,
          rotateEnable: false,
          pitchEnable: false,
          dragEnable: true,
          zoomEnable: true,
          doubleClickZoom: true,
          showLabel: true,
          zooms: [3, 19],
          mapStyle: preferredMapStyle(),
        })

        created = map
        mapRef.current = map
        infoWindowRef.current = new ns.InfoWindow({ offset: new ns.Pixel(0, -12) })

        // 系统切换深色模式时底图跟着换
        theme = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null
        syncTheme = () => map.setMapStyle(preferredMapStyle())
        theme?.addEventListener('change', syncTheme)

        // 用户自己动过地图之后，就不再自动把视角拉走
        const markMoved = () => {
          userMovedRef.current = true
        }
        map.on('dragstart', markMoved)
        map.on('zoomstart', markMoved)

        if (onPickRef.current) {
          map.on('click', (event: { lnglat: AMap.LngLat }) => {
            const pick = onPickRef.current
            if (!pick) return
            const lng = event.lnglat.getLng()
            const lat = event.lnglat.getLat()
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
            // 地图给的是 GCJ-02，转回 WGS84 再交出去
            pick(fromMapLngLat(lng, lat))
          })
        }

        // 横竖屏切换、卡片尺寸变化时高德需要重新量一次
        observer = new ResizeObserver(() => map.resize())
        observer.observe(container)

        setFailure(null)
        setPhase('ready')
        setReadyNonce((value) => value + 1)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPhase('failed')
        setFailure(toAmapLoadMessage(error))
      })

    return () => {
      cancelled = true
      if (theme && syncTheme) theme.removeEventListener('change', syncTheme)
      if (observer) observer.disconnect()
      /*
       * 顺序很要紧：**先把引用清掉，再销毁地图**。
       *
       * 卸载时 React 按声明顺序跑清理函数，这个 effect 排在最前面，所以它的
       * destroy() 会先于下面那些覆盖物的 remove() 执行。清引用这一步就是给
       * 它们留的刹车：removeOverlays 看到图已经换人了就不会再碰它。
       */
      if (created) {
        if (mapRef.current === created) mapRef.current = null
        infoWindowRef.current = null
        created.destroy()
      }
      fittedRef.current = false
      userMovedRef.current = false
    }
  }, [reloadNonce])

  /* ------------------------------ 轨迹线 ------------------------------ */

  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0) return

    const overlays: AMap.Polyline[] = []

    for (const segment of splitTrackSegments(points)) {
      const path = segment.map((point) => toMapLngLat(point))
      if (path.length < 2) continue

      // 白色描边 + 彩色线：浅色底图上看得清，深色底图上也不糊
      overlays.push(
        new AMap.Polyline({
          path,
          strokeColor: '#ffffff',
          strokeWeight: 7,
          strokeOpacity: 0.85,
          lineJoin: 'round',
          lineCap: 'round',
          clickable: false,
          zIndex: 50,
        }),
      )
      overlays.push(
        new AMap.Polyline({
          path,
          strokeColor: TRACK_COLOR,
          strokeWeight: 4,
          strokeOpacity: 0.95,
          lineJoin: 'round',
          lineCap: 'round',
          clickable: false,
          zIndex: 60,
        }),
      )
    }

    if (overlays.length > 0) map.add(overlays)
    return () => {
      removeOverlays(map, overlays)
    }
  }, [points, readyNonce, removeOverlays])

  /* ------------------------------ 标点 ------------------------------ */

  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0) return

    const overlays: AMap.CircleMarker[] = []

    for (const spot of spots) {
      if (!hasCoords(spot)) continue

      const position = toMapLngLat(spot)
      const marker = new AMap.CircleMarker({
        center: position,
        radius: 7,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
        fillColor: '#d4881f',
        fillOpacity: 1,
        zIndex: 300,
      })

      marker.on('click', () => {
        openPopup(
          '标点',
          [
            spot.name,
            spot.placeName ?? '',
            `${spot.latitude.toFixed(5)}, ${spot.longitude.toFixed(5)}`,
          ],
          position,
        )
      })

      overlays.push(marker)
    }

    if (overlays.length > 0) map.add(overlays)
    return () => {
      removeOverlays(map, overlays)
    }
  }, [spots, readyNonce, openPopup, removeOverlays])

  /* ------------------------------ 渔获 ------------------------------ */

  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0) return

    const overlays: AMap.Marker[] = []

    for (const record of catches) {
      if (!hasCoords(record)) continue

      const position = toMapLngLat(record)
      const size = [
        record.lengthCm !== null ? formatLength(record.lengthCm) : null,
        record.weightG !== null ? formatWeight(record.weightG) : null,
      ]
        .filter((text): text is string => text !== null)
        .join(' · ')

      const marker = new AMap.Marker({
        position,
        anchor: 'center',
        content: createMarkerElement('trip-map__catch', FISH_GLYPH),
        zIndex: 400,
      })

      marker.on('click', () => {
        openPopup(
          record.species || '未填写鱼种',
          [
            `${formatClockSec(record.caughtAt)} 上鱼`,
            size,
            `${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}`,
          ],
          position,
        )
      })

      overlays.push(marker)
    }

    if (overlays.length > 0) map.add(overlays)
    return () => {
      removeOverlays(map, overlays)
    }
  }, [catches, readyNonce, openPopup, removeOverlays])

  /* ---------------------------- 当前定位点 ---------------------------- */

  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0) return

    const overlays: (AMap.Circle | AMap.Marker)[] = []

    if (current) {
      const position = toMapLngLat(current)

      // 精度圈：让用户直观看到这次定位大概有多准
      if (Number.isFinite(current.accuracy) && current.accuracy > 0) {
        overlays.push(
          new AMap.Circle({
            center: position,
            radius: Math.min(current.accuracy, 2000),
            strokeColor: CURRENT_COLOR,
            strokeWeight: 1,
            strokeOpacity: 0.5,
            fillColor: CURRENT_COLOR,
            fillOpacity: 0.12,
            clickable: false,
            zIndex: 30,
          }),
        )
      }

      overlays.push(
        new AMap.Marker({
          position,
          anchor: 'center',
          content: createMarkerElement('trip-map__current'),
          clickable: false,
          zIndex: 600,
        }),
      )
    }

    if (overlays.length > 0) map.add(overlays)
    return () => {
      removeOverlays(map, overlays)
    }
  }, [current, readyNonce, removeOverlays])

  /* ---------------------------- 回放移动标记 ---------------------------- */

  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0 || !head) return

    const marker = new AMap.Marker({
      position: toMapLngLat(head),
      anchor: 'center',
      content: createMarkerElement('trip-map__head'),
      clickable: false,
      zIndex: 700,
    })

    map.add(marker)
    return () => {
      removeOverlays(map, [marker])
    }
  }, [head, readyNonce, removeOverlays])

  /* ------------------------------ 选点标记 ------------------------------ */

  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0 || !picked) return

    const marker = new AMap.Marker({
      // 圆心就是选中的那个点，所以用 center 对齐，不玩「针尖指哪儿」的视觉猜谜
      position: toMapLngLat(picked),
      anchor: 'center',
      content: createMarkerElement('trip-map__picked'),
      clickable: false,
      zIndex: 800,
    })

    map.add(marker)
    return () => {
      removeOverlays(map, [marker])
    }
  }, [picked, readyNonce, removeOverlays])

  /* ------------------------------ 视角 ------------------------------ */

  const hasAnyData =
    points.length > 0 ||
    spots.some(hasCoords) ||
    catches.some(hasCoords) ||
    current !== null ||
    picked !== null

  // 第一次拿到数据时自动全览一次；之后只跟随，不重置
  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0 || !autoFit || fittedRef.current || !hasAnyData) {
      return
    }

    // 不传参数 = 把地图上现有的覆盖物全部框进画面
    map.setFitView(undefined, false, [30, 30, 30, 30], FOCUS_ZOOM)
    fittedRef.current = true
  }, [autoFit, hasAnyData, readyNonce, points, spots, catches, current, picked])

  // 当前位置跑出画面时才平移过去，而且仅限用户没有自己动过地图的时候
  useEffect(() => {
    const map = mapRef.current
    const ns = window.AMap
    if (!map || !ns || readyNonce === 0 || !current || userMovedRef.current) return

    const [lng, lat] = toMapLngLat(current)
    const bounds = map.getBounds()
    if (bounds && !bounds.contains(new ns.LngLat(lng, lat))) {
      map.panTo([lng, lat])
    }
  }, [current, readyNonce])

  // 外部要求把镜头挪到某个点（搜索命中的地点、刚开始选点时的当前位置）
  useEffect(() => {
    const map = mapRef.current
    if (!map || readyNonce === 0 || !focus) return

    const [lng, lat] = toMapLngLat(focus)
    map.setZoomAndCenter(focus.zoom ?? 16, [lng, lat])
  }, [focus, readyNonce])

  // 回放时跟着移动标记走，同样尊重用户的拖动
  useEffect(() => {
    const map = mapRef.current
    const ns = window.AMap
    if (!map || !ns || readyNonce === 0 || !head || userMovedRef.current) return

    const [lng, lat] = toMapLngLat(head)
    const bounds = map.getBounds()
    if (bounds && !bounds.contains(new ns.LngLat(lng, lat))) {
      map.panTo([lng, lat])
    }
  }, [head, readyNonce])

  const showEmpty = !onPick && hasAnyData === false && phase !== 'failed'

  return (
    <div className={`trip-map${className ? ` ${className}` : ''}`} style={{ height }}>
      <div className="trip-map__canvas" ref={containerRef} />

      {phase === 'loading' && (
        <div className="trip-map__veil">
          <p>正在加载地图…</p>
        </div>
      )}

      {phase === 'failed' && (
        <div className="trip-map__veil trip-map__veil--failed">
          <span className="trip-map__empty-icon" aria-hidden="true">
            <MapIcon size={20} />
          </span>
          <p>{failure}</p>
          <p className="trip-map__veil-hint">
            地图加载不出来时，出勤、渔获和轨迹记录都照常能用。
          </p>
          <button
            type="button"
            className="trip-map__retry"
            onClick={() => {
              setPhase('loading')
              setFailure(null)
              setReloadNonce((value) => value + 1)
            }}
          >
            重试
          </button>
        </div>
      )}

      {showEmpty && (
        <div className="trip-map__empty">
          <span className="trip-map__empty-icon" aria-hidden="true">
            <MapIcon size={20} />
          </span>
          <p>{emptyText}</p>
        </div>
      )}

      {/*
        高德退回 IP 定位时，图上那个「当前位置」其实在几公里外。
        地图自己也得说清楚，不能只靠旁边的卡片提醒。
      */}
      {current && current.source === 'ip' && (
        <p className="trip-map__ip-note">图上的当前位置是高德返回的 IP 大致位置，仅供参考</p>
      )}

      {phase === 'ready' && hasAnyData && autoFit && (
        <button
          type="button"
          className="trip-map__fit"
          onClick={() => {
            userMovedRef.current = false
            const map = mapRef.current
            if (map) map.setFitView(undefined, false, [30, 30, 30, 30], FOCUS_ZOOM)
          }}
        >
          全览
        </button>
      )}
    </div>
  )
}
