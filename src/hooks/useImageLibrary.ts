import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteImagesOfGear,
  getAllImages,
  putImage,
  validateImageFile,
} from '../lib/imageStore'

export interface GearImage {
  /** 已经 createObjectURL 的地址，随组件卸载自动释放 */
  url: string
  size: number
  updatedAt: number
}

/**
 * 一次读取全部用户图片，按 gearId 建索引。
 * 列表里每件装备都要显示缩略图，逐个查询会产生 N 次事务，这里只查一次。
 */
export function useImageLibrary() {
  const [images, setImages] = useState<Record<string, GearImage>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  // 当前存活的 object URL，state 与 ref 同步维护，便于精确释放
  const imagesRef = useRef<Record<string, GearImage>>({})
  const urlsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // 捕获 Set 对象本身（Set 从不被替换，只做原地增删），
    // 这样卸载时能释放到期间由 saveImage/removeImage 新增的地址
    const urls = urlsRef.current
    let cancelled = false

    getAllImages('original')
      .then((records) => {
        if (cancelled) return

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
      })
      .catch(() => {
        // 图片库不可用不影响文字数据，只是没有缩略图
        if (!cancelled) setLoadError('图片库读取失败，暂时无法显示照片')
      })

    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
      imagesRef.current = {}
    }
  }, [])

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
