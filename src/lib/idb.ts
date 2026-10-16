/**
 * LureMate 的 IndexedDB 统一入口。
 *
 * 一个数据库 luremate，下分几个彼此独立的对象仓库：
 * - images：装备照片
 * - catchPhotos：渔获照片
 * - trackPoints：GPS 轨迹点（V3 新增）
 *
 * 升级版本时只补齐缺少的仓库，**绝不删除或重建已有仓库**，
 * 所以老用户的装备照片、渔获照片在升级后一定还在。
 */

export const DB_NAME = 'luremate'

/** v3：在 v2（images + catchPhotos）基础上增加 trackPoints */
export const DB_VERSION = 3

export const IMAGE_STORE = 'images'
export const CATCH_PHOTO_STORE = 'catchPhotos'
export const TRACK_STORE = 'trackPoints'

/** 轨迹按 sessionId 查询的索引名 */
export const TRACK_SESSION_INDEX = 'bySession'

export type IdbErrorCode = 'unavailable' | 'blocked' | 'storage'

export class IdbError extends Error {
  code: IdbErrorCode

  constructor(code: IdbErrorCode, message: string) {
    super(message)
    this.name = 'IdbError'
    this.code = code
  }
}

export function toIdbErrorMessage(error: unknown): string {
  if (error instanceof IdbError) return error.message
  return '本地数据读写失败，请稍后再试'
}

export function isIdbError(error: unknown): error is IdbError {
  return error instanceof IdbError
}

let dbPromise: Promise<IDBDatabase> | null = null

/** 打开数据库；失败后允许下次重试，而不是一直返回失败的 Promise */
export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new IdbError('unavailable', '当前浏览器不支持本地数据存储'))
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      reject(new IdbError('unavailable', '无法打开本地数据库'))
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result

      // 只补齐缺少的仓库，已有的数据原样保留
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: ['gearId', 'kind'] })
      }
      if (!db.objectStoreNames.contains(CATCH_PHOTO_STORE)) {
        db.createObjectStore(CATCH_PHOTO_STORE, { keyPath: ['catchId', 'kind'] })
      }
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        const store = db.createObjectStore(TRACK_STORE, { keyPath: 'id' })
        store.createIndex(TRACK_SESSION_INDEX, 'sessionId', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new IdbError('unavailable', '无法打开本地数据库'))
    request.onblocked = () =>
      reject(new IdbError('blocked', '本地数据库被其他标签页占用，请关掉其它页面后重试'))
  })

  dbPromise.catch(() => {
    dbPromise = null
  })

  return dbPromise
}

export function storageError(message = '本地数据写入失败，可能是存储空间不足'): IdbError {
  return new IdbError('storage', message)
}

/** 单个读请求 */
export async function idbRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase()

  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(storeName, mode)
    } catch {
      reject(storageError('本地数据库暂不可用，请刷新页面重试'))
      return
    }

    const store = transaction.objectStore(storeName)
    const request = run(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(storageError())
    transaction.onabort = () => reject(storageError())
  })
}

/** 一个或多个写操作，整个事务提交后才算成功 */
export async function idbTransactionDone(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(storeName, mode)
    } catch {
      reject(storageError('本地数据库暂不可用，请刷新页面重试'))
      return
    }

    run(transaction.objectStore(storeName))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(storageError())
    transaction.onabort = () => reject(storageError())
  })
}
