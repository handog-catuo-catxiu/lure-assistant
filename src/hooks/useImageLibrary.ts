import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteImagesOfGear,
  getAllImages,
  putImage,
  validateImageFile,
} from '../lib/imageStore'
import { subscribeRemoteApplied } from '../lib/sync/events'

export interface GearImage {
  /** 已经 createObjectURL 的地址，随组件卸载自动释放 */
  url: string
  size: number
  updatedAt: number
}

/**
 * 一次读取全部用户图片，按 gearId 建索引。
 * 列表里每件装备都要显示缩略图，逐个查询会产生 N 次事务，这里只查一次。
 *
 * 云端拉取下来的照片也写在同一份 IndexedDB 里，合并完成后会重新读取，
 * 不需要刷新页面。
 */
export function useImageLibrary() {
  const [images, setImages] = useState<Record<string, GearImage>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  // 当前存活的 object URL，state 与 ref 同步维护，便于精确释放
  const imagesRef = useRef<Record<string, GearImage>>({})
  const urlsRef = useRef<Set<string>>(new Set())
  const generationRef = useRef(0)

  const reload = useCallback(async () => {
    const generation = ++generationRef.current
    try {
      const records = await getAllImages('original')
      if (generation !== generationRef.current) return

      // 释放上一批地址，避免反复同步时内存越占越多
      for (const url of urlsRef.current) URL.revokeObjectURL(url)
      urlsRef.current.clear()

      const next: Record<string, GearImage> = {}
      for (const record of records) {
        const url = URL.createObjectURL(record.blob)
        urlsRef.current.add(url)
        next[record.gearId] = {
          url,
          size: record.size,
          updatedAt: record.updatedAt,
        }
      }

      imagesRef.current = next
      setImages(next)
      setLoadError(null)
    } catch {
      // 图片库不可用不影响文字数据，只是没有缩略图
      if (generation === generationRef.current) {
        setLoadError('图片库读取失败，暂时无法显示照片')
      }
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
      imagesRef.current = {}
    }
  }, [reload])

  // 云端照片下载完成 / 被删除后，重新读取
  useEffect(
    () =>
      subscribeRemoteApplied((kind) => {
        if (kind === 'image') void reload()
      }),
    [reload],
  )

  const releaseUrl = useCallback((gearId: string) => {
    const current = imagesRef.current[gearId]
    if (!current) return
    URL.revokeObjectURL(current.url)
    urlsRef.current.delete(current.url)
  }, [])

  /** 上传或替换图片（先校验格式和大小，失败会抛出可直接展示的错误） */
  const saveImage = useCallback(
    async (gearId: string, file: File) => {
      validateImageFile(file)

      // 先写库，成功了再更新界面，避免出现「显示成功但其实没存上」
      await putImage(gearId, file, 'original')

      releaseUrl(gearId)
      const url = URL.createObjectURL(file)
      urlsRef.current.add(url)

      const next = {
        ...imagesRef.current,
        [gearId]: { url, size: file.size, updatedAt: Date.now() },
      }
      imagesRef.current = next
      setImages(next)
    },
    [releaseUrl],
  )

  /** 删除用户图片（图鉴图片和示意图不受影响） */
  const removeImage = useCallback(
    async (gearId: string) => {
      await deleteImagesOfGear(gearId)

      releaseUrl(gearId)
      const next = { ...imagesRef.current }
      delete next[gearId]
      imagesRef.current = next
      setImages(next)
    },
    [releaseUrl],
  )

  return { images, loadError, saveImage, removeImage }
}

/** 装备照片接口，供需要向下传递的页面使用 */
export type ImageLibraryApi = ReturnType<typeof useImageLibrary>
