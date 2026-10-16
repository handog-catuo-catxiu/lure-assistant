import { useEffect, useState } from 'react'
import { loadLastFix } from '../lib/lastFix'
import type { GeoPoint } from '../types/trip'

/**
 * 上一次成功定位的位置，从 localStorage 读。
 *
 * 只是给用户一个参考：这次定位还没回来时，他知道自己上次在哪儿。
 * **不是当前位置**，界面上必须写明这一点，也不能拿它当上鱼位置。
 */
export function useLastFix(): GeoPoint | null {
  const [fix, setFix] = useState<GeoPoint | null>(null)

  useEffect(() => {
    let cancelled = false
    // 异步读，回来再 setState（也避免在 effect 里同步 setState）
    loadLastFix().then((stored) => {
      if (!cancelled) setFix(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return fix
}
