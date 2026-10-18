import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGear, saveGear } from '../lib/gearStorage'
import { subscribeRemoteApplied } from '../lib/sync/events'
import type { GearDraft, GearItem } from '../types/gear'

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `gear-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 装备数据的唯一入口：React state 管理，变更后自动写入 localStorage。
 */
export function useGear() {
  const [items, setItems] = useState<GearItem[]>(loadGear)

  // 初次挂载只是把本地数据读进 state，不需要再写回一遍；
  // 否则演示数据会在用户没做任何修改时就被写进 localStorage。
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    saveGear(items)
  }, [items])

  // 云端合并完成后重新读取本地数据，页面不用刷新
  useEffect(
    () =>
      subscribeRemoteApplied((kind) => {
        if (kind === 'gear') setItems(loadGear())
      }),
    [],
  )

  const addGear = useCallback((draft: GearDraft) => {
    const item: GearItem = { ...draft, id: createId() }
    // 新增的排在最前，方便刚添加完就看到
    setItems((prev) => [item, ...prev])
    return item
  }, [])

  const updateGear = useCallback((id: string, draft: GearDraft) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...draft, id } : item)),
    )
  }, [])

  const removeGear = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toggleFavorite = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite } : item,
      ),
    )
  }, [])

  /** 切换「在首页显示装备图片」，与文字数据一起写进 localStorage */
  const setShowImageOnHome = useCallback((id: string, value: boolean) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, showImageOnHome: value } : item,
      ),
    )
  }, [])

  return {
    items,
    addGear,
    updateGear,
    removeGear,
    toggleFavorite,
    setShowImageOnHome,
  }
}

/** 装备数据的接口，供需要向下传递的页面使用 */
export type GearApi = ReturnType<typeof useGear>
