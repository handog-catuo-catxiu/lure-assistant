/**
 * 用户图片存储（IndexedDB）。
 *
 * 装备的文字数据继续放在 localStorage，只有图片 Blob 放这里。
 * 记录主键是 [gearId, kind] 复合键：这样将来 AI 生成的图片可以存成
 * kind: 'ai' 的独立记录，永远不会覆盖用户上传的原图（kind: 'original'）。
 */

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

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const ACCEPTED_IMAGE_EXT = /\.(jpe?g|png|webp)$/i

const DB_NAME = 'luremate'
const DB_VERSION = 1
const STORE_NAME = 'images'

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

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new ImageStoreError('unavailable', '当前浏览器不支持本地图片存储'))
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      reject(new ImageStoreError('unavailable', '无法打开本地图片库'))
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: ['gearId', 'kind'] })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new ImageStoreError('unavailable', '无法打开本地图片库'))
    request.onblocked = () =>
      reject(new ImageStoreError('unavailable', '图片库被其他标签页占用，请关闭后重试'))
  })

  // 打开失败后允许下次重试，而不是一直返回失败的 Promise
  dbPromise.catch(() => {
    dbPromise = null
  })

  return dbPromise
}

function storageError(): ImageStoreError {
  return new ImageStoreError('storage', '本地图片存储失败，可能是空间不足')
}

/** 单个读请求 */
async function requestOf<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()

  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(STORE_NAME, mode)
    } catch {
      reject(storageError())
      return
    }

    const request = run(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(storageError())
    transaction.onabort = () => reject(storageError())
  })
}

/** 多个写操作，整个事务提交后才算成功 */
async function transactionDone(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDb()

  return new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(STORE_NAME, mode)
    } catch {
      reject(storageError())
      return
    }

    run(transaction.objectStore(STORE_NAME))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(storageError())
    transaction.onabort = () => reject(storageError())
  })
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
  await transactionDone('readwrite', (store) => {
    store.put(record)
  })
  return record
}

export function getImage(
  gearId: string,
  kind: ImageKind = 'original',
): Promise<StoredImage | null> {
  return requestOf<StoredImage | undefined>('readonly', (store) =>
    store.get([gearId, kind]) as IDBRequest<StoredImage | undefined>,
  ).then((record) => record ?? null)
}

/** 读取某一种类的全部图片，用于一次性拿到所有缩略图 */
export async function getAllImages(kind: ImageKind = 'original'): Promise<StoredImage[]> {
  const records = await requestOf<StoredImage[]>('readonly', (store) =>
    store.getAll() as IDBRequest<StoredImage[]>,
  )
  return records.filter((record) => record.kind === kind)
}

export function deleteImage(
  gearId: string,
  kind: ImageKind = 'original',
): Promise<void> {
  return transactionDone('readwrite', (store) => {
    store.delete([gearId, kind])
  })
}

/** 删除装备时清掉它的所有图片（含未来可能存在的 AI 图） */
export function deleteImagesOfGear(gearId: string): Promise<void> {
  return transactionDone('readwrite', (store) => {
    store.delete([gearId, 'original'])
    store.delete([gearId, 'ai'])
  })
}
