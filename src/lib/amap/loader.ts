/**
 * 高德地图 JS API 2.0 的加载器。
 *
 * 官方两种加载方式：
 * 1. 在 HTML 里写死 `<script src="https://webapi.amap.com/maps?v=2.0&key=...">`
 * 2. 运行时动态插入这个 script 标签（官方也有 @amap/amap-jsapi-loader 做同一件事）
 *
 * 这里用第 2 种，自己写一个几十行的加载器，原因有两个：
 * - 安全密钥配置 `window._AMapSecurityConfig` **必须在脚本加载之前**设置好，
 *   自己控制加载时机最稳妥；
 * - 不引入额外的依赖包，也不需要把 Key 写进 index.html。
 *
 * 加载失败（没配 Key、断网、被墙、脚本超时）一律 reject 一个带人话的
 * AmapLoadError，由地图组件显示提示 —— 出勤、渔获、装备等功能完全不受影响。
 */
import { getAmapConfig } from './config'

const SCRIPT_ID = 'luremate-amap-jsapi'
const LOAD_TIMEOUT_MS = 20_000

export class AmapLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmapLoadError'
  }
}

let pending: Promise<typeof AMap> | null = null

function buildScriptUrl(key: string, version: string, plugins: string[]): string {
  const params = new URLSearchParams({
    v: version,
    key,
    plugin: plugins.join(','),
  })
  return `https://webapi.amap.com/maps?${params.toString()}`
}

function injectScript(url: string): Promise<typeof AMap> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID)
    if (existing) existing.remove()

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.async = true
    script.src = url

    const timer = window.setTimeout(() => {
      cleanup()
      reject(
        new AmapLoadError('高德地图脚本加载超时了，可能是网络问题。可以点重试，或者先不用地图。'),
      )
    }, LOAD_TIMEOUT_MS)

    function cleanup() {
      window.clearTimeout(timer)
      script.onload = null
      script.onerror = null
    }

    script.onload = () => {
      cleanup()
      if (window.AMap) {
        resolve(window.AMap)
        return
      }
      reject(new AmapLoadError('高德地图脚本加载完成了，但没有拿到 AMap 命名空间。'))
    }

    script.onerror = () => {
      cleanup()
      reject(
        new AmapLoadError(
          '高德地图脚本没能加载（请检查网络，以及高德控制台里的域名白名单是否包含当前网址）。',
        ),
      )
    }

    document.head.appendChild(script)
  })
}

/**
 * 加载并返回 `AMap` 命名空间。
 *
 * - 重复调用只会真正加载一次（同一 Promise）
 * - `force = true` 时清掉缓存重新加载，给「重试」按钮用
 */
export function loadAmap(force = false): Promise<typeof AMap> {
  if (force) pending = null
  if (pending) return pending

  const config = getAmapConfig()
  if (!config) {
    return Promise.reject(
      new AmapLoadError(
        '还没有配置高德地图 Key。请在 .env.local 里设置 VITE_AMAP_KEY 之后重新启动开发服务器。',
      ),
    )
  }

  if (window.AMap) {
    pending = Promise.resolve(window.AMap)
    return pending
  }

  /*
   * 安全密钥这一步：只设置代理地址，**不设置 securityJsCode**。
   * 高德会把服务类请求发到 `serviceHost` 上，由代理补上密钥再转发。
   *
   * 这个地址到手之前已经在 config.ts 里规范化成 `<域名>/_AMapService` 了：
   * 高德会检查 serviceHost 的一级路由，不合格就在 localhost 上弹 alert 把页面挡住。
   * 完全没有代理时才给一个空对象（不带 serviceHost），此时底图照常显示，
   * 服务类接口会明确报错。
   */
  window._AMapSecurityConfig = config.securityProxyHost
    ? { serviceHost: config.securityProxyHost }
    : {}

  pending = injectScript(
    buildScriptUrl(config.key, config.version, config.plugins),
  ).catch((error: unknown) => {
    // 失败不缓存，下次进入地图可以再试一次
    pending = null
    throw error instanceof AmapLoadError
      ? error
      : new AmapLoadError('高德地图加载失败，请稍后再试。')
  })

  return pending
}

/** 地图没加载出来时给用户看的那句话 */
export function toAmapLoadMessage(error: unknown): string {
  if (error instanceof AmapLoadError) return error.message
  return '高德地图加载失败，请稍后再试。出勤、渔获和轨迹记录都不受影响。'
}
