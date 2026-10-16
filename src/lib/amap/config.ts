/**
 * 高德地图的接入配置。
 *
 * ## 两个东西，分别管理
 *
 * 1. **Web 端 Key**（`VITE_AMAP_KEY`）
 *    公开信息，本来就会出现在网页源码里。高德靠「域名白名单」保护它，
 *    所以在高德控制台里必须把线上域名（GitHub Pages 的域名）加进去。
 *
 * 2. **安全密钥**（不在这里读，也永远不会进前端代码）
 *    高德 JS API 2.0 要求所有服务类请求（逆地理编码、POI 搜索）都带上安全密钥。
 *    按官方文档，安全密钥要么写在 `window._AMapSecurityConfig.securityJsCode`
 *    （等于公开，任何人都能在源码里看到），要么配置一台**代理服务器**，
 *    由代理在转发时补上密钥。本项目选后者：
 *
 *    - 前端只知道代理地址（`VITE_AMAP_SECURITY_PROXY_HOST`）
 *    - 密钥只存在于代理服务自己的环境变量里
 *    - 开发环境用 vite.config.ts 里的本地代理（密钥放在 .env.local，不进 Git）
 *
 *    注意：**Vite 的环境变量保护不了前端密钥**。
 *    任何以 `VITE_` 开头的变量都会被打包进 JS，等于公开，
 *    所以安全密钥绝对不能走 `VITE_` 前缀 —— 这个文件里也不提供这样的入口。
 */

/**
 * 高德安全代理的固定一级路由。
 *
 * 这个字符串不是我们随便起的名字，是高德 JS API 2.0 安全代理规范的一部分：
 * SDK 会把 `serviceHost` 的第一段路径抠出来比对，不是 `_AMapService` 就在
 * localhost / 127.0.0.1 上直接弹 alert 挡住页面
 * （「使用 JSAPI 安全模式，代理服务请以 _AMapService 作为一级路由」）。
 * 代理服务（本地中间件、Cloudflare Worker）都挂在这条路径上。
 */
export const AMAP_SERVICE_ROUTE = '_AMapService'

/** 开发环境用的本地代理路径，与 vite.config.ts 中的中间件保持一致 */
export const AMAP_DEV_PROXY_PATH = `/${AMAP_SERVICE_ROUTE}`

/** 需要加载的高德插件：定位 + 逆地理编码 + POI 搜索 */
export const AMAP_PLUGINS = [
  'AMap.Geolocation',
  'AMap.Geocoder',
  'AMap.PlaceSearch',
] as const

export interface AmapConfig {
  /** Web 端 Key（公开） */
  key: string
  /**
   * 安全密钥代理地址，例如 `https://luremate-amap.example.workers.dev`。
   * 交给 SDK 之前会规范化成 `<协议>://<域名>/_AMapService`（见 toServiceHost）。
   * 空串表示没有配置：地图底图还能画，但高德的服务类接口不可用。
   */
  securityProxyHost: string
  version: string
  plugins: string[]
}

function readEnv(name: string): string {
  const value = (import.meta.env as Record<string, unknown>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * 把配置值补成完整地址。
 *
 * 只写路径（例如 `/_AMapService`）表示「同源代理」——本地开发就是这么配的。
 * 高德 SDK 需要的是一个完整地址，相对路径它自己拼不出来，所以这里补上当前站点域名。
 * 拿不到 window（理论上的非浏览器环境）时返回空串：宁可让界面提示「未配置代理」，
 * 也不要送一个高德用不了的地址过去。
 */
function resolveUrl(value: string): string {
  const trimmed = stripTrailingSlash(value)
  if (!trimmed.startsWith('/')) return trimmed
  if (typeof window === 'undefined') return ''
  return stripTrailingSlash(new URL(trimmed, window.location.origin).toString())
}

/**
 * 把代理地址规范化成高德要的形状：`<协议>://<域名>/_AMapService`。
 *
 * 只保留协议和域名，**路径一律换成 `_AMapService`**。原因是 SDK 认的就是这一段：
 * 配置里写成老路径（`/amap-proxy`）、写成域名根、或者多带一段前缀，它都会判定
 * 「代理没按规范部署」——在 localhost 上弹 alert，在正式域名上也会打警告，
 * 而把 `_AMapService` 之后的路径交给我们自己控制的代理去认，就一定对得上。
 *
 * 高德官方文档里的代理示例同样是把服务挂在 `_AMapService` 上，
 * 所以这不是绕开检查，而是按规范来。
 */
function toServiceHost(value: string): string {
  const resolved = resolveUrl(value)
  if (!resolved) return ''

  try {
    const url = new URL(resolved)
    url.pathname = AMAP_DEV_PROXY_PATH
    url.search = ''
    url.hash = ''
    return stripTrailingSlash(url.toString())
  } catch {
    // 解析不出域名的值（少写协议之类）当作没配：与其把坏地址交给 SDK 让它悄悄失败，
    // 不如让界面上的说明告诉用户该去配什么
    return ''
  }
}

/**
 * 没有配置生产代理时，开发环境自动用本地 vite 代理。
 * 这样 `npm run dev` 只要有 Key + 本地 .env.local 里的密钥就能完整联调。
 */
function resolveProxyHost(): string {
  const configured = readEnv('VITE_AMAP_SECURITY_PROXY_HOST')
  if (configured) return toServiceHost(configured)

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return stripTrailingSlash(
      new URL(AMAP_DEV_PROXY_PATH, window.location.origin).toString(),
    )
  }
  return ''
}

let cached: AmapConfig | null | undefined

/** 读取配置；没有 Key 时返回 null（地图区域会显示一句人话说明） */
export function getAmapConfig(): AmapConfig | null {
  if (cached !== undefined) return cached

  const key = readEnv('VITE_AMAP_KEY')
  cached = key
    ? {
        key,
        securityProxyHost: resolveProxyHost(),
        version: '2.0',
        plugins: [...AMAP_PLUGINS],
      }
    : null

  return cached
}

/** 地图底图能不能画：只要有 Key 就行 */
export function canRenderMap(): boolean {
  return getAmapConfig() !== null
}

/**
 * 高德的服务类接口（逆地理编码、POI 搜索）能不能用：
 * 除了 Key，还必须有一台带安全密钥的代理。
 */
export function canUseAmapServices(): boolean {
  const config = getAmapConfig()
  return config !== null && config.securityProxyHost !== ''
}

/** 缺什么、该怎么办，一句话说清；配置齐全时返回 null */
export function describeAmapGap(): string | null {
  const config = getAmapConfig()
  if (!config) {
    return '还没有配置高德地图 Key：请在项目根目录的 .env.local 里填 VITE_AMAP_KEY（详见 README 的高德接入说明）。'
  }
  if (!config.securityProxyHost) {
    return '高德服务类接口需要安全密钥代理：请部署代理服务并配置 VITE_AMAP_SECURITY_PROXY_HOST（详见 proxy/README.md）。地图底图不受影响。'
  }
  return null
}
