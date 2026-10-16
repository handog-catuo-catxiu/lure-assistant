import { useCallback, useEffect, useState } from 'react'
import { cacheKeyOf, reverseGeocode } from '../lib/amap/geocode'
import type { PlaceName } from '../lib/amap/geocode'
import type { Coordinate } from '../lib/coord'

/**
 * 把一次定位读数换成地名（高德逆地理编码）。
 *
 * 只在「手上多了一个新坐标」时查一次：开始出勤、钓点页里点获取位置、
 * 在地图上选点，都是用户主动的动作；轨迹记录自己不会调用它，
 * 所以出勤途中不会有任何地名请求。
 *
 * ## 这个 hook 对「坐标对象换了新引用」是免疫的
 *
 * effect 依赖的是坐标对象本身，所以调用方每次渲染新建一个字面量坐标时，
 * effect 就会每渲染重跑一次。这里做了两层保护：
 *   1. 结果没变化时原样返回旧的 state（同一个引用，React 会跳过重渲染）；
 *   2. 同一个坐标的查询结果在 lib/amap/geocode 里按经纬度缓存了 30 分钟，
 *      重跑也不会真的再发一次请求。
 * 少了第 1 条，上面的场景就会变成「渲染 → 查地名 → 改 state → 再渲染」的死循环。
 */

export type PlaceStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'error'

export interface PlaceNameApi {
  status: PlaceStatus
  place: PlaceName | null
  /** 查询失败的提示。定位成功状态不受影响 */
  error: string | null
  /** 再查一次（刚才没网之类的） */
  retry: () => void
}

interface PlaceState {
  key: string
  status: Exclude<PlaceStatus, 'idle' | 'loading'>
  place: PlaceName | null
  error: string | null
}

const EMPTY_STATE: PlaceState = { key: '', status: 'empty', place: null, error: null }

/** 两条地名结果算不算同一份（用来避免无意义的状态更新） */
function samePlace(a: PlaceName | null, b: PlaceName | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.name === b.name && a.area === b.area && a.full === b.full
}

export function usePlaceName(point: Coordinate | null): PlaceNameApi {
  const key = point ? cacheKeyOf(point) : null

  const [state, setState] = useState<PlaceState>(EMPTY_STATE)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!point || !key) return

    let cancelled = false
    reverseGeocode(point).then((result) => {
      if (cancelled) return

      setState((previous) => {
        const next: PlaceState =
          result.status === 'ok'
            ? { key, status: 'ok', place: result.place, error: null }
            : result.status === 'empty'
              ? { key, status: 'empty', place: null, error: null }
              : { key, status: 'error', place: null, error: result.message }

        /*
         * 结果和手上这份一模一样就原样返回旧对象 —— React 见到同一个引用会跳过重渲染。
         * 这一步是必需的：这个 effect 依赖 point 对象，而调用方只要不小心每次渲染
         * 都新建一个字面量坐标，effect 就会每渲染重跑一次；如果每次都换新 state，
         * 就会变成「渲染 → 查地名 → 改 state → 再渲染」的死循环，页面直接卡住。
         */
        if (
          previous.key === next.key &&
          previous.status === next.status &&
          previous.error === next.error &&
          samePlace(previous.place, next.place)
        ) {
          return previous
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [point, key, nonce])

  const retry = useCallback(() => setNonce((value) => value + 1), [])

  // 换了坐标、结果还没回来，就是「查询中」——状态由 key 推导，不用额外 setState
  if (!point) {
    return { status: 'idle', place: null, error: null, retry }
  }

  const matched = state.key === key
  return {
    status: matched ? state.status : 'loading',
    place: matched ? state.place : null,
    error: matched ? state.error : null,
    retry,
  }
}
