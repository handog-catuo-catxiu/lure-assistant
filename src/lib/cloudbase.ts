/**
 * CloudBase 身份认证（Auth v3，PostgreSQL 环境推荐）的唯一入口。
 *
 * 这里只做两件事：按需加载 SDK、初始化 app 实例（认证和以后的数据同步共用）。
 * 环境 ID 会出现在浏览器里，属于公开信息；SecretId / SecretKey 一律不进前端，
 * 也不在本项目任何地方配置。
 *
 * 接口对照（v3 手机号验证码，勿与 v2 的 getVerification / signInWithEmail 混用）：
 * - 发送验证码（未注册会自动创建账号）：auth.signInWithOtp({ phone })
 *   → data.verifyOtp({ token }) 验证短信码并写入登录态
 * - 恢复会话：auth.getSession()，data.session 为空表示未登录
 * - 退出登录：auth.signOut()
 *
 * Publishable Key 是 CloudBase 的前端公开凭据（不是 SecretKey）：
 * 手机号登录本身不需要它；云同步和对象存储需要配置它。
 * 未配置时前端只使用本机存储，不发送注定失败的同步请求。
 */
import type { Cloudbase } from '@cloudbase/js-sdk/app'
import type { AuthOtpResponse, SignInRes } from '@cloudbase/js-sdk/auth'

const FALLBACK_ENV_ID = 'luremate-d5gilu0y4efa3b802'
const REGION = 'ap-shanghai'

const runtimeEnv = import.meta.env as Record<string, string | undefined>
const publishableKey = runtimeEnv.VITE_PUBLISHABLE_KEY?.trim()

/**
 * 数据库与对象存储的公开客户端凭据是否已经配置。
 * 没配置时登录仍可用，但同步引擎会停在本机模式，不去发必然失败的请求。
 */
export function hasPublishableKey(): boolean {
  return Boolean(publishableKey)
}

/** 认证层只依赖 v3 的这三个方法，便于以后替换或扩展而不影响页面。 */
export interface CloudbaseAuth {
  signInWithOtp(params: { phone: string }): Promise<AuthOtpResponse>
  getSession(): Promise<SignInRes>
  signOut(): Promise<{ error?: unknown | null }>
}

export const CLOUDBASE_ENV_ID =
  runtimeEnv.VITE_CLOUDBASE_ENV_ID?.trim() || FALLBACK_ENV_ID

let appPromise: Promise<Cloudbase> | null = null
let authPromise: Promise<CloudbaseAuth> | null = null

/**
 * CloudBase app 实例的唯一入口。
 *
 * 以后接入 PostgreSQL 装备同步时，直接用这个实例调用 app.rdb()；
 * 不要再 init 第二个 app，否则登录态和数据请求不共享。
 * SDK 按需加载，认证/数据库代码单独成块，不进入主包。
 */
export function getCloudbaseApp(): Promise<Cloudbase> {
  if (!appPromise) {
    appPromise = (async () => {
      // 导入 @cloudbase/js-sdk/auth 时，SDK 通常会自动注册 auth 组件。
      // 但开发环境的模块热更新可能让 app / auth 落在不同的模块实例上，
      // 所以这里按需补注册一次；已经注册就不调用，避免重复注册警告。
      const [{ default: cloudbase }, { registerAuth }] = await Promise.all([
        import('@cloudbase/js-sdk/app'),
        import('@cloudbase/js-sdk/auth'),
      ])
      if (typeof cloudbase.auth !== 'function') {
        registerAuth(cloudbase)
      }

      const app = cloudbase.init({
        env: CLOUDBASE_ENV_ID,
        region: REGION,
        // 没有 Publishable Key 时省略 accessKey，不要用环境 ID 或占位符冒充。
        ...(publishableKey ? { accessKey: publishableKey } : {}),
        auth: { detectSessionInUrl: true },
      })
      return app as unknown as Cloudbase
    })().catch((error: unknown) => {
      // 初始化失败后允许下一次重试（例如网络恢复后再次点登录）
      appPromise = null
      throw error
    })
  }
  return appPromise
}

/**
 * 认证实例。会话持久化在本地，刷新页面后仍保持登录。
 *
 * app.auth() 只在首次调用时初始化，之后复用同一个 Auth 实例：
 * 重复传参调用会创建新的 Auth 实例，导致登录态互不相通。
 */
export function getAuth(): Promise<CloudbaseAuth> {
  if (!authPromise) {
    authPromise = (async () => {
      const app = await getCloudbaseApp()
      const auth = app.auth({ persistence: 'local' })
      if (!auth) throw new Error('CloudBase auth 初始化失败')
      return auth as unknown as CloudbaseAuth
    })().catch((error: unknown) => {
      authPromise = null
      throw error
    })
  }
  return authPromise
}
