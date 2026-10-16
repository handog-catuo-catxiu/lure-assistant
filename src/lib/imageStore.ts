/**
 * 用户图片存储（IndexedDB）。
 *
 * 装备的文字数据继续放在 localStorage，只有图片 Blob 放这里。
 * 记录主键是 [gearId, kind] 复合键：这样将来 AI 生成的图片可以存成
 * kind: 'ai' 的独立记录，永远不会覆盖用户上传的原图（kind: 'original'）。
 *
 * V2 新增渔获照片：另开一个 catchPhotos 仓库，主键 [catchId, kind]。
 * 只是新增仓库，原来的 images（装备照片）原样保留，不受影响。
 *
 * 数据库的连接与版本升级统一放在 lib/idb.ts。
 */
import {
  CATCH_PHOTO_STORE,
  IMAGE_STORE,
  IdbError,
  idbRequest,
  idbTransactionDone,
  toIdbErrorMessage,
} from './idb'

/** 图片种类：original = 用户原始上传，ai = 未来 AI 生成结果 */
export type ImageKind = 'original' | 'ai'

export interface StoredImage {
  gearId: string
  kind: ImageKind
  blob: Blob
  type: string
  /** 字节数 */
  size: number
  updatedAt: number
}

/** 渔获照片，按 catchId 存放 */
export interface StoredCatchPhoto {
  catchId: string
  kind: ImageKind
  blob: Blob
  type: string
  size: number
  updatedAt: number
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const ACCEPTED_IMAGE_EXT = /\.(jpe?g|png|webp)$/i

export type ImageErrorCode = 'unsupported' | 'too-large' | 'storage' | 'unavailable'

export class ImageStoreError extends Error {
  code: ImageErrorCode

  constructor(code: ImageErrorCode, message: string) {
    super(message)
    this.name = 'ImageStoreError'
    this.code = code
  }
}

/** 把任意异常转成可以直接展示给用户的中文提示 */
export function toImageErrorMessage(error: unknown): string {
  if (error instanceof ImageStoreError) return error.message
  if (error instanceof IdbError) return toIdbErrorMessage(error)
  return '图片处理失败，请稍后再试'
}

/** 上传前的校验：格式与大小 */
export function validateImageFile(file: File): void {
  const type = file.type.toLowerCase()
  const accepted =
    ACCEPTED_IMAGE_TYPES.includes(type) || ACCEPTED_IMAGE_EXT.test(file.name)

  if (!accepted) {
    throw new ImageStoreError('unsupported', '只支持 JPG / PNG / WebP 格式的图片')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageStoreError('too-large', '图片超过 5MB，请压缩后再上传')
  }
}

/** 保存图片；同一个 gearId + kind 会被覆盖（替换照片） */
export async function putImage(
  gearId: string,
  blob: Blob,
  kind: ImageKind = 'original',
): Promise<StoredImage> {
  const record: StoredImage = {
    gearId,
    kind,
    blob,
    type: blob.type,
    size: blob.size,
    updatedAt: Date.now(),
  }
  await idbTransactionDone(IMAGE_STORE, 'readwrite', (store) => {
    store.put(record)
  })
  return record
}

export function getImage(
  gearId: string,
  kind: ImageKind = 'original',
): Promise<StoredImage | null> {
  return idbRequest<StoredImage | undefined>(IMAGE_STORE, 'readonly', (store) =>
    store.get([gearId, kind]) as IDBRequest<StoredImage | undefined>,
  ).then((record) => record ?? null)
}

/** 读取某一种类的全部图片，用于一次性拿到所有缩略图 */
export async function getAllImages(kind: ImageKind = 'original'): Promise<StoredImage[]> {
  const records = await idbRequest<StoredImage[]>(IMAGE_STORE, 'readonly', (store) =>
    store.getAll() as IDBRequest<StoredImage[]>,
  )
  return records.filter((record) => record.kind === kind)
}

export function deleteImage(
  gearId: string,
  kind: ImageKind = 'original',
): Promise<void> {
  return idbTransactionDone(IMAGE_STORE, 'readwrite', (store) => {
    store.delete([gearId, kind])
  })
}

/** 删除装备时清掉它的所有图片（含未来可能存在的 AI 图） */
export function deleteImagesOfGear(gearId: string): Promise<void> {
  return idbTransactionDone(IMAGE_STORE, 'readwrite', (store) => {
    store.delete([gearId, 'original'])
    store.delete([gearId, 'ai'])
  })
}

/* ------------------------------- 渔获照片 ------------------------------- */

/** 保存渔获照片；同一条渔获重复上传会覆盖 */
export async function putCatchPhoto(
  catchId: string,
  blob: Blob,
  kind: ImageKind = 'original',
): Promise<StoredCatchPhoto> {
  const record: StoredCatchPhoto = {
    catchId,
    kind,
    blob,
    type: blob.type,
    size: blob.size,
    updatedAt: Date.now(),
  }
  await idbTransactionDone(CATCH_PHOTO_STORE, 'readwrite', (store) => {
    store.put(record)
  })
  return record
}

/** 读取全部渔获照片，用于一次性拿到所有渔获缩略图 */
export async function getAllCatchPhotos(
  kind: ImageKind = 'original',
): Promise<StoredCatchPhoto[]> {
  const records = await idbRequest<StoredCatchPhoto[]>(
    CATCH_PHOTO_STORE,
    'readonly',
    (store) => store.getAll() as IDBRequest<StoredCatchPhoto[]>,
  )
  return records.filter((record) => record.kind === kind)
}

/** 删除渔获时清掉它的照片 */
export function deleteCatchPhotos(catchId: string): Promise<void> {
  return idbTransactionDone(CATCH_PHOTO_STORE, 'readwrite', (store) => {
    store.delete([catchId, 'original'])
    store.delete([catchId, 'ai'])
  })
}
