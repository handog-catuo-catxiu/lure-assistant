import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'

/**
 * 高德要求代理地址的一级路由就是这个名字：
 * 前端把 `_AMapService` 配进 `window._AMapSecurityConfig.serviceHost` 之后，
 * 高德 SDK 会检查这一段，不是它就在 localhost 上弹 alert（挡着页面），
 * 其他域名下打一行控制台日志。所以本地代理也照这个规矩来。
 */
const AMAP_SERVICE_ROUTE = '_AMapService'

/** 本地开发代理路径，和 src/lib/amap/config.ts 里的 AMAP_DEV_PROXY_PATH 保持一致 */
const AMAP_DEV_PROXY_PATH = `/${AMAP_SERVICE_ROUTE}`
/** 老配置（/amap-proxy）继续可用，省得已经填过的人一脸问号 */
const AMAP_DEV_PROXY_ALIASES = ['/amap-proxy']
/** 高德 Web 服务（REST）地址，只转发到这里，不做通用代理 */
const AMAP_REST_HOST = 'https://restapi.amap.com'
/** 只放行高德的服务路径，避免这个中间件被当成任意转发器 */
const ALLOWED_PATH_PREFIX = '/v3/'

/**
 * 开发环境的「安全密钥代理」。
 *
 * ## 为什么需要它
 *
 * 高德 JS API 2.0 要求逆地理编码、POI 搜索这类**服务类请求**带上安全密钥。
 * 密钥不能写进前端源码（写了就等于公开），所以官方给的方案是：
 * 前端只管把请求发到一个代理地址，由代理在转发时补上密钥。
 * 这个中间件就是开发环境的那台代理 —— 生产环境用 proxy/ 目录下的 Worker。
 *
 * ## 密钥从哪来
 *
 * `.env.local` 里的 `AMAP_SECURITY_CODE`。这个变量**故意不带 VITE_ 前缀**：
 * 带 VITE_ 的变量会被 Vite 打进前端包，等于把密钥公开出去。
 * 这里是在 Node 侧读的，只有开发服务器自己知道。
 *
 * ## 安全边界
 *
 * - 固定转发到 restapi.amap.com，只允许 /v3/ 开头的路径 → 不是开放代理
 * - 没有配置密钥时直接回一句 500 并说明缺什么，不会静默失败
 * - 只在 dev server 里启用（`apply: 'serve'`），构建产物里没有这段代码
 */
function amapDevProxy(securityCode: string): Plugin {
  return {
    name: 'luremate-amap-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      const handler = (req: IncomingMessage, res: ServerResponse) => {
        const path = req.url ?? '/'

        if (!path.startsWith(ALLOWED_PATH_PREFIX)) {
          res.statusCode = 403
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end('这个代理只转发高德 /v3/ 服务请求。')
          return
        }
        if (!securityCode) {
          res.statusCode = 500
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end(
            '没有读到 AMAP_SECURITY_CODE：请在项目根目录的 .env.local 里填上高德安全密钥（这个文件不会进 Git）。',
          )
          return
        }

        // 只改查询串，不动路径；密钥只加在服务端这一跳
        const target = new URL(path, AMAP_REST_HOST)
        target.searchParams.set('jscode', securityCode)

        fetch(target, { method: req.method ?? 'GET' })
          .then(async (upstream) => {
            const body = await upstream.text()
            res.statusCode = upstream.status
            res.setHeader(
              'content-type',
              upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
            )
            res.end(body)
          })
          .catch((error: unknown) => {
            server.config.logger.warn(
              `高德代理转发失败：${error instanceof Error ? error.message : String(error)}`,
            )
            res.statusCode = 502
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.end('代理连不上高德服务，检查一下网络。')
          })
      }

      // 正式路径 + 老路径都挂上：换路径不会把已经配好的本地环境搞坏
      server.middlewares.use(AMAP_DEV_PROXY_PATH, handler)
      for (const alias of AMAP_DEV_PROXY_ALIASES) {
        server.middlewares.use(alias, handler)
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 *  AI 鱼情推荐的本地代理（DeepSeek）
 * ------------------------------------------------------------------ */

/** 前端调用的路径，和 src/lib/fish/ai/config.ts 一致 */
const AI_ROUTE_PREFIX = '/ai'
const AI_HEALTH_ROUTE = '/health'
const AI_ADVICE_ROUTE = '/fish-advice'

/** DeepSeek 官方接口；只连这一台，不做通用转发 */
const DEEPSEEK_HOST = 'https://api.deepseek.com'
/** 只有当 ANTHROPIC_BASE_URL 指向这个域名时，才允许复用 Claude Code 的 token */
const DEEPSEEK_HOSTNAME = 'api.deepseek.com'

/**
 * 我们自己打的标记，服务端用它确认「这是 LureMate 的推荐请求」，
 * 免得这个接口被人当成免费的大模型代理。
 * 与 src/lib/fish/ai/prompt.ts 的 AI_PROMPT_TAG、proxy/worker.js 保持一致。
 */
const AI_PROMPT_TAG = 'LureMate::fish-advice::v1'

/*
 * 下面这些参数**写死在服务端**，前端既看不到也改不了：
 * 模型固定、输出上限固定，单次成本就是封顶的。
 */
const AI_MODEL = 'deepseek-chat'
const AI_MAX_TOKENS = 900
const AI_TEMPERATURE = 0.3
const AI_TIMEOUT_MS = 25_000

/** 请求体上限：只收一段提示词，用不着更大 */
const AI_MAX_BODY_BYTES = 32 * 1024
/** 提示词总字数上限 */
const AI_MAX_PROMPT_CHARS = 16_000

/** 探活失败时给用户看的原因（和前端 client.ts 的措辞口径一致） */
const AI_HEALTH_HINT =
  '没有配置 DEEPSEEK_API_KEY：在项目根目录的 .env.local 里加一行即可（这个文件不会进 Git）。'

/**
 * 开发环境的「AI 推荐代理」。
 *
 * 把前端的推荐请求转发给 DeepSeek。密钥只在这一侧读取，
 * **不带 VITE_ 前缀、不打进前端包、不写进日志、不出现在任何响应里**：
 *
 *   1. 优先用 `.env.local` / 环境变量里的 `DEEPSEEK_API_KEY`；
 *   2. 没有的话，如果 `ANTHROPIC_BASE_URL` 指向 api.deepseek.com
 *      （即 Claude Code 本身正跑在 DeepSeek 官方接口上），就复用它的
 *      `ANTHROPIC_AUTH_TOKEN`。这个值是**就地使用**的：不复制、不落盘、
 *      不打印，进程结束就没了。
 *
 * 生产环境用 proxy/worker.js 那台 Cloudflare Worker，逻辑一一对应，
 * 那边还会多一层每 IP 限流和每日额度。
 */
function aiDevProxy(env: Record<string, string>): Plugin {
  const readVar = (name: string): string => (env[name] ?? process.env[name] ?? '').trim()

  function resolveKey(): { key: string; source: string } | null {
    const direct = readVar('DEEPSEEK_API_KEY')
    if (direct) return { key: direct, source: 'DEEPSEEK_API_KEY（.env.local）' }

    const baseUrl = readVar('ANTHROPIC_BASE_URL')
    const token = readVar('ANTHROPIC_AUTH_TOKEN')
    if (!baseUrl || !token) return null
    try {
      if (new URL(baseUrl).hostname !== DEEPSEEK_HOSTNAME) return null
    } catch {
      // BASE_URL 写得不像个地址就不复用，宁可不启用也不能拿错密钥去请求
      return null
    }
    return { key: token, source: 'ANTHROPIC_AUTH_TOKEN（Claude Code 正在用的 DeepSeek Key）' }
  }

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }

  return {
    name: 'luremate-ai-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      /** 密钥来源只提示一次，不必每个请求都唠叨一遍 */
      let announced = false

      server.middlewares.use(AI_ROUTE_PREFIX, (req, res) => {
        const path = (req.url ?? '/').split('?')[0]
        const credentials = resolveKey()

        if (path === AI_HEALTH_ROUTE) {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'bad-request' })
            return
          }
          sendJson(res, 200, {
            ok: true,
            enabled: credentials !== null,
            model: credentials ? AI_MODEL : null,
            detail: credentials ? null : AI_HEALTH_HINT,
          })
          return
        }

        if (path !== AI_ADVICE_ROUTE) {
          sendJson(res, 404, { ok: false, error: 'not-found' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'bad-request' })
          return
        }
        if (!credentials) {
          sendJson(res, 503, { ok: false, error: 'no-key', message: AI_HEALTH_HINT })
          return
        }
        if (!announced) {
          announced = true
          // 只说来源，不说密钥
          server.config.logger.info(`[ai-proxy] 用 ${credentials.source} 调用 DeepSeek 做鱼种推荐`)
        }

        void handleAdvice(req, res, credentials.key)
      })
    },
  }
}

/** 读请求体，顺手卡住体积 */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

/** 校验请求体：只收两条消息，且 system 里必须带我们自己打的标记 */
function readMessages(body: unknown): { system: string; user: string } | null {
  if (!body || typeof body !== 'object') return null
  const messages = (body as { messages?: unknown }).messages
  if (!Array.isArray(messages) || messages.length !== 2) return null

  const [first, second] = messages as { role?: unknown; content?: unknown }[]
  if (first?.role !== 'system' || second?.role !== 'user') return null
  if (typeof first.content !== 'string' || typeof second.content !== 'string') return null
  if (!first.content.includes(AI_PROMPT_TAG)) return null
  if (first.content.length + second.content.length > AI_MAX_PROMPT_CHARS) return null

  return { system: first.content, user: second.content }
}

async function handleAdvice(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string,
): Promise<void> {
  const raw = await readBody(req, AI_MAX_BODY_BYTES)
  if (raw === null) {
    res.statusCode = 413
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: false, error: 'bad-request', message: '请求体过大' }))
    return
  }

  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 解析不了就保持 null，下面统一按格式不对处理
  }

  const messages = readMessages(parsed)
  if (!messages) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: false, error: 'bad-request', message: '请求格式不被接受' }))
    return
  }

  try {
    const upstream = await fetch(`${DEEPSEEK_HOST}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 密钥只出现在这一跳，浏览器永远看不到它
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
        max_tokens: AI_MAX_TOKENS,
        temperature: AI_TEMPERATURE,
        stream: false,
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })

    if (!upstream.ok) {
      // 只透传状态码，不透传上游正文：上游报错里可能带着请求信息
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          ok: false,
          error: 'upstream',
          message: `DeepSeek 返回 ${upstream.status}`,
        }),
      )
      return
    }

    const data = (await upstream.json()) as {
      model?: string
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content ?? ''

    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: true, model: data.model ?? AI_MODEL, content }))
  } catch (error: unknown) {
    res.statusCode = 504
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        ok: false,
        error: 'upstream',
        message: `调用 DeepSeek 失败：${error instanceof Error ? error.name : '未知错误'}`,
      }),
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  /*
   * 第三个参数传空串 = 连没有 VITE_ 前缀的变量一起读，
   * 这样 AMAP_SECURITY_CODE 才拿得到（它必须留在 Node 侧）。
   */
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      amapDevProxy(env.AMAP_SECURITY_CODE ?? ''),
      /*
       * 注意：`npm run dev` 时 .env.local 是在这份配置加载前读进 env 的，
       * 所以这里能直接拿到。改了 .env.local 要重启 dev server。
       */
      aiDevProxy(env),
    ],
    /**
     * GitHub Pages 的项目站点地址是 https://<用户名>.github.io/lure-assistant/，
     * 静态资源必须带上 /lure-assistant/ 前缀，所以打包（production）时设置 base。
     *
     * 开发（npm run dev）和单元调试仍用 '/'：这样 http://localhost:5173/
     * 直接就是首页，不用手动敲子路径，热更新和各种工具链的相对路径也不受影响。
     *
     * 注意：`npm run preview` 属于 production 模式，同样会带 /lure-assistant/ 前缀，
     * 访问时要打开 http://localhost:4173/lure-assistant/。
     */
    base: mode === 'production' ? '/lure-assistant/' : '/',
  }
})
