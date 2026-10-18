/**
 * CloudBase PostgreSQL（PostgREST）与对象存储的薄封装。
 *
 * 前端只使用公开能力：
 * - app.rdb()：带着当前登录用户的会话令牌请求数据库，RLS 在服务端判断 user_id
 * - app.storage.from(bucket)：对象存储，文件路径第一段是 uid，RLS 同样在服务端判断
 *
 * 这里不出现、也不需要数据库密码、SecretId / SecretKey 或 Service Role 密钥。
 * 客户端永远不自己传 user_id 作为身份依据：服务端列默认 auth.uid()，
 * 并且 RLS 会拒绝访问别人的行。
 */
import { getCloudbaseApp, hasPublishableKey } from '../cloudbase'

export interface RdbError {
  message?: string
  details?: string
  hint?: string
  code?: string
}

export interface RdbResponse<T> {
  data: T[] | null
  error: RdbError | null
  count: number | null
  status: number
  statusText: string
}

type FilterValue = string | number | boolean | null

export interface RdbQuery<T> extends PromiseLike<RdbResponse<T>> {
  select(
    columns?: string,
    options?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' },
  ): RdbQuery<T>
  insert(
    values: unknown,
    options?: { count?: 'exact' | 'planned' | 'estimated'; defaultToNull?: boolean },
  ): RdbQuery<T>
  upsert(
    values: unknown,
    options?: {
      onConflict?: string
      ignoreDuplicates?: boolean
      count?: 'exact' | 'planned' | 'estimated'
      defaultToNull?: boolean
    },
  ): RdbQuery<T>
  update(values: unknown, options?: { count?: 'exact' }): RdbQuery<T>
  delete(options?: { count?: 'exact' }): RdbQuery<T>
  eq(column: string, value: FilterValue): RdbQuery<T>
  neq(column: string, value: FilterValue): RdbQuery<T>
  gt(column: string, value: FilterValue): RdbQuery<T>
  gte(column: string, value: FilterValue): RdbQuery<T>
  lt(column: string, value: FilterValue): RdbQuery<T>
  lte(column: string, value: FilterValue): RdbQuery<T>
  in(column: string, values: FilterValue[]): RdbQuery<T>
  ilike(column: string, pattern: string): RdbQuery<T>
  or(filter: string): RdbQuery<T>
  is(column: string, value: null | boolean): RdbQuery<T>
  not(column: string, operator: string, value: FilterValue): RdbQuery<T>
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): RdbQuery<T>
  limit(count: number): RdbQuery<T>
  range(from: number, to: number): RdbQuery<T>
  single(): RdbQuery<T>
  maybeSingle(): RdbQuery<T>
  throwOnError(): RdbQuery<T>
}

export interface RdbClient {
  from<T = Record<string, unknown>>(table: string): RdbQuery<T>
  rpc<T = unknown>(
    fn: string,
    params?: Record<string, unknown>,
    options?: { head?: boolean; get?: boolean; count?: 'exact' | 'planned' | 'estimated' },
  ): RdbQuery<T>
}

export interface StorageUploadResult {
  id?: string
  path: string
  fullPath: string
}

export interface StorageErrorLike {
  message?: string
  statusCode?: number | string
  error?: string
}

export type StorageResult<T> =
  | { data: T; error: null }
  | { data: null; error: StorageErrorLike }

export interface StorageFileApiLike {
  upload(
    path: string,
    body: Blob | File,
    options?: { contentType?: string; upsert?: boolean; cacheControl?: string },
  ): Promise<StorageResult<StorageUploadResult>>
  download(path: string): PromiseLike<StorageResult<Blob>>
  remove(paths: string[]): Promise<StorageResult<unknown>>
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<StorageResult<{ fullSignedURL: string }>>
  getPublicUrl(path: string): { data: { publicUrl: string } }
}

export interface StorageClientLike {
  from(bucketId: string): StorageFileApiLike
}

const FALLBACK_USER_MEDIA_BUCKET = 'luremate-user-media'
const FALLBACK_CATALOG_BUCKET = 'luremate-catalog'

const runtimeEnv = import.meta.env as Record<string, string | undefined>

export function userMediaBucket(): string {
  return runtimeEnv.VITE_USER_MEDIA_BUCKET?.trim() || FALLBACK_USER_MEDIA_BUCKET
}

export function catalogBucket(): string {
  return runtimeEnv.VITE_CATALOG_BUCKET?.trim() || FALLBACK_CATALOG_BUCKET
}

let rdbPromise: Promise<RdbClient> | null = null
let storagePromise: Promise<StorageClientLike> | null = null

/** 云端数据库/存储是否已配置；未配置时留在本机模式，不制造必然失败的请求 */
export function isCloudDataConfigured(): boolean {
  return hasPublishableKey()
}

/** 数据库客户端；与登录共用同一个 app 实例，令牌由 SDK 自动带上 */
export function getRdb(): Promise<RdbClient> {
  if (!rdbPromise) {
    rdbPromise = (async () => {
      const app = await getCloudbaseApp()
      const holder = app as unknown as { rdb?: () => RdbClient }
      if (typeof holder.rdb !== 'function') {
        // SDK 的 mysql 入口会同时注册 mysql 和 rdb 两个组件
        const { registerMySQL } = await import('@cloudbase/js-sdk/mysql')
        registerMySQL(app as unknown as Parameters<typeof registerMySQL>[0])
      }
      if (typeof holder.rdb !== 'function') {
        throw new CloudApiError('database-unavailable', '数据库组件不可用，请刷新页面后重试')
      }
      return holder.rdb()
    })().catch((error: unknown) => {
      rdbPromise = null
      throw error
    })
  }
  return rdbPromise
}

/** 对象存储客户端 */
export function getStorage(): Promise<StorageClientLike> {
  if (!storagePromise) {
    storagePromise = (async () => {
      const app = await getCloudbaseApp()
      const holder = app as unknown as { storage?: StorageClientLike }
      if (!holder.storage) {
        const { registerStorage } = await import('@cloudbase/js-sdk/storage')
        registerStorage(app as unknown as Parameters<typeof registerStorage>[0])
      }
      if (!holder.storage) {
        throw new CloudApiError('storage-unavailable', '文件存储组件不可用，请刷新页面后重试')
      }
      return holder.storage
    })().catch((error: unknown) => {
      storagePromise = null
      throw error
    })
  }
  return storagePromise
}

export class CloudApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CloudApiError'
    this.code = code
  }
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * 把 SDK / 网络 / RLS 的错误翻译成用户能看懂的提示。
 * 不把服务端原始 message 直接放到界面上（可能带表名、请求细节）。
 */
export function cloudErrorMessage(error: unknown): string {
  if (error instanceof CloudApiError) return error.message

  if (isOffline()) return NETWORK_MESSAGE

  const raw = error instanceof Error ? error.message : ''
  const code =
    typeof error === 'object' && error !== null
      ? String((error as { code?: unknown }).code ?? '')
      : ''
  const status =
    typeof error === 'object' && error !== null
      ? Number((error as { status?: unknown }).status ?? 0)
      : 0

  if (status === 0 || /fetch|network|timeout|load failed|ERR_NETWORK/i.test(raw)) {
    return NETWORK_MESSAGE
  }
  if (status === 401 || status === 403 || code === '42501' || /JWT|permission|denied|row-level/i.test(raw)) {
    return '没有权限读写这份数据，请重新登录后再试'
  }
  if (status === 404 || code === 'PGRST205' || /schema cache|does not exist/i.test(raw)) {
    return '云端数据表还没有创建，请先按项目 README 的数据库初始化步骤完成配置'
  }
  return '云同步暂时没有完成，请稍后重试'
}

export function isPermissionError(error: unknown): boolean {
  return cloudErrorMessage(error).includes('没有权限')
}

const NETWORK_MESSAGE = '网络连接失败，记录已保存在本机，联网后会自动重试'
