import { useCallback, useState } from 'react'
import { toImageErrorMessage } from '../lib/imageStore'
import { useToast } from './useToast'
import type { CatchPhotoLibraryApi } from './useCatchPhotos'
import type { TripApi } from './useTrip'
import type { CatchRecord, CatchSavePayload } from '../types/trip'

interface CatchEditorOptions {
  trip: TripApi
  catchPhotos: CatchPhotoLibraryApi
}

/**
 * 渔获的补充 / 编辑 / 删除。正在出勤页和历史详情页都要做同一件事，
 * 所以把「改渔获文字数据 + 改渔获照片 + 顺手加入出勤装备」这一套放在这里，
 * 页面只负责渲染弹窗。
 */
export function useCatchEditor({ trip, catchPhotos }: CatchEditorOptions) {
  const [editing, setEditing] = useState<CatchRecord | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CatchRecord | null>(null)
  const { message, showToast } = useToast()

  const openEditor = useCallback((record: CatchRecord) => setEditing(record), [])
  const closeEditor = useCallback(() => setEditing(null), [])
  const requestDelete = useCallback((record: CatchRecord) => setPendingDelete(record), [])
  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  /** 保存渔获信息；返回错误文案，null 表示成功（调用方据此决定是否关弹窗） */
  const saveCatch = useCallback(
    (record: CatchRecord, payload: CatchSavePayload): string | null => {
      const result = trip.updateCatch(record.id, payload.draft)
      if (!result.ok) return result.error

      // 「同时加入本次出勤装备」：只在出勤还没结束时生效，失败也不影响渔获本身
      if (payload.addGearIds.length > 0) {
        const session = trip.sessionById(record.sessionId)
        if (session && session.status === 'active') {
          const merged = [...new Set([...session.gearIds, ...payload.addGearIds])]
          const gearResult = trip.setTripGear(session.id, merged)
          if (!gearResult.ok) showToast('渔获已保存，但出勤装备没能更新')
        }
      }

      // 照片写进 IndexedDB，不影响已经保存好的文字数据
      const { file, remove } = payload.photo
      if (file) {
        catchPhotos.savePhoto(record.id, file).catch((error) => {
          showToast(toImageErrorMessage(error))
        })
      } else if (remove) {
        catchPhotos.removePhoto(record.id).catch((error) => {
          showToast(toImageErrorMessage(error))
        })
      }

      showToast('已保存渔获信息')
      return null
    },
    [trip, catchPhotos, showToast],
  )

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return

    const target = pendingDelete
    setPendingDelete(null)

    const result = trip.removeCatch(target.id)
    if (!result.ok) {
      showToast(result.error)
      return
    }
    showToast('已删除这条渔获')

    // 渔获没了，照片也没必要留着
    catchPhotos.removePhoto(target.id).catch(() => {
      showToast('渔获已删除，但照片清理失败')
    })
  }, [pendingDelete, trip, catchPhotos, showToast])

  return {
    editing,
    openEditor,
    closeEditor,
    saveCatch,
    pendingDelete,
    requestDelete,
    cancelDelete,
    confirmDelete,
    toastMessage: message,
    showToast,
  }
}
