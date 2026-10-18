import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteCatchPhotos,
  getAllCatchPhotos,
  putCatchPhoto,
  validateImageFile,
} from '../lib/imageStore'
import { subscribeRemoteApplied } from '../lib/sync/events'

export interface CatchPhoto {
  /** 已经 createObjectURL 的地址，随组件卸载自动释放 */
  url: string
  size: number
  updatedAt: number
}

/**
 * 渔获照片。和装备照片分开存在 IndexedDB 的另一个仓库里，按 catchId 建索引。
 * 一次性读全部，列表里每条渔获都要显示缩略图，逐个查询会产生 N 次事务。
 *
 * 云端拉取下来的照片同样写进 IndexedDB，合并完成后重新读取。
 */
export function useCatchPhotos() {
  const [photos, setPhotos] = useState<Record<string, CatchPhoto>>({})

  // 当前存活的 object URL，state 与 ref 同步维护，便于精确释放
  const photosRef = useRef<Record<string, CatchPhoto>>({})
  const urlsRef = useRef<Set<string>>(new Set())
  const generationRef = useRef(0)

  const reload = useCallback(async () => {
    const generation = ++generationRef.current
    try {
      const records = await getAllCatchPhotos('original')
      if (generation !== generationRef.current) return

      for (const url of urlsRef.current) URL.revokeObjectURL(url)
      urlsRef.current.clear()

      const next: Record<string, CatchPhoto> = {}
      for (const record of records) {
        const url = URL.createObjectURL(record.blob)
        urlsRef.current.add(url)
        next[record.catchId] = {
          url,
          size: record.size,
          updatedAt: record.updatedAt,
        }
      }

      photosRef.current = next
      setPhotos(next)
    } catch {
      // 照片库不可用不影响渔获的文字数据，只是没有照片
    }
  }, [])

  useEffect(() => {
    // 初始加载本身是异步的，setState 发生在 IndexedDB 读取完成之后，不是同步级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
    const urls = urlsRef.current
    return () => {
      generationRef.current += 1
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
      photosRef.current = {}
    }
  }, [reload])

  useEffect(
    () =>
      subscribeRemoteApplied((kind) => {
        if (kind === 'image') void reload()
      }),
    [reload],
  )

  const releaseUrl = useCallback((catchId: string) => {
    const current = photosRef.current[catchId]
    if (!current) return
    URL.revokeObjectURL(current.url)
    urlsRef.current.delete(current.url)
  }, [])

  /** 上传或替换渔获照片，失败会抛出可直接展示的错误 */
  const savePhoto = useCallback(
    async (catchId: string, file: File) => {
      validateImageFile(file)

      // 先写库，成功了再更新界面，避免出现「显示成功但其实没存上」
      await putCatchPhoto(catchId, file, 'original')

      releaseUrl(catchId)
      const url = URL.createObjectURL(file)
      urlsRef.current.add(url)

      const next = {
        ...photosRef.current,
        [catchId]: { url, size: file.size, updatedAt: Date.now() },
      }
      photosRef.current = next
      setPhotos(next)
    },
    [releaseUrl],
  )

  const removePhoto = useCallback(
    async (catchId: string) => {
      await deleteCatchPhotos(catchId)

      releaseUrl(catchId)
      const next = { ...photosRef.current }
      delete next[catchId]
      photosRef.current = next
      setPhotos(next)
    },
    [releaseUrl],
  )

  return { photos, savePhoto, removePhoto }
}

export type CatchPhotoLibraryApi = ReturnType<typeof useCatchPhotos>
