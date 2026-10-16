/**
 * AI 推荐层的接入配置。
 *
 * ## 密钥不在这一层，也不在浏览器里
 *
 * DeepSeek 的 API Key **只存在于服务端代理的环境变量里**：
 * 开发环境是 `vite.config.ts` 里的本地中间件（密钥放在 .env.local，不进 Git），
 * 生产环境是 `proxy/worker.js` 这台 Cloudflare Worker。
 *
 * 前端只知道代理地址（`VITE_AI_PROXY_HOST`），而且这个地址是可以公开的 ——
 * 它不带任何密钥，代理那一侧会做白名单、限流和额度控制。
 * 这里不提供读取 API Key 的入口，也不允许任何 `VITE_` 变量承载密钥。
 *
 * 没有配置代理地址时不是「坏掉」，而是「未启用」：首页照常给出本地规则推荐，
 * 并如实写明这次没有用到 AI。
 */

/** 分析接口路径，和 proxy/worker.js 里的路由保持一致 */
export const AI_ADVICE_PATH = '/ai/fish-advice'
/** 探活接口：用于判断这条链路上到底有没有可用的 AI */
export const AI_HEALTH_PATH = '/ai/health'

function readEnv(name: string): string {
  const value = (import.meta.env as Record<string, unknown>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * 代理基地址。
 *
 * - 填了 `VITE_AI_PROXY_HOST`（例如 `https://luremate-ai.xxx.workers.dev`）就用它；
 * - 没填时返回空串 = 同源相对路径：开发环境下 Vite 中间件就挂在 `/ai` 上，
 *   所以 `npm run dev` 不填也能联调；而 GitHub Pages 上同源没有这个接口，
 *   探活会失败并如实标成「未启用」，不会静默地拿假的推荐糊弄过去。
 */
export function getAiProxyBase(): string {
  return stripTrailingSlash(readEnv('VITE_AI_PROXY_HOST'))
}

export function aiEndpoint(path: string): string {
  return `${getAiProxyBase()}${path}`
}

/** 界面上要署名的模型名，与服务端实际调用的模型保持一致 */
export const AI_MODEL_LABEL = 'DeepSeek'
