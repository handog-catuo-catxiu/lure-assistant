/**
 * LureMate 的服务端代理 —— Cloudflare Worker 版本，负责两件事：
 *
 *   1. 高德安全密钥代理：前端（GitHub Pages 上的静态页面）把高德的服务类请求
 *      发到这里，由这里补上安全密钥（`jscode`）再转发给 `restapi.amap.com`。
 *   2. DeepSeek 代理：首页的「今日推荐鱼种」把提示词发到 `/ai/fish-advice`，
 *      由这里带上 API Key 去调 DeepSeek，再把结果原样回给前端。
 *
 * 两个密钥都只存在 Worker 的环境变量里，**永远不会出现在前端源码或 Git 仓库中**。
 *
 * ## 部署
 *
 * ```bash
 * npm i -g wrangler          # 或者 npx wrangler
 * wrangler login
 * wrangler secret put AMAP_SECURITY_CODE     # 高德安全密钥，不会写进任何文件
 * wrangler secret put DEEPSEEK_API_KEY       # DeepSeek 的 sk- 开头的 Key
 * wrangler deploy --name luremate-proxy
 * ```
 *
 * 可选的环境变量（用 `wrangler secret put` 或写在 wrangler.toml 的 [vars] 里）：
 *
 * | 变量 | 默认 | 说明 |
 * | --- | --- | --- |
 * | `ALLOWED_ORIGINS` | 不限制 | 逗号分隔的来源白名单，例如 `https://you.github.io`。**建议设置** |
 * | `RATE_LIMIT_PER_HOUR` | 20 | 每个 IP 每小时能调几次 AI |
 * | `DAILY_REQUEST_CAP` | 500 | 全部用户每天能调几次 AI（费用总闸） |
 *
 * 前端按需填两个地址：
 *   - `VITE_AMAP_SECURITY_PROXY_HOST` = `https://<名字>.<子域>.workers.dev/_AMapService`
 *   - `VITE_AI_PROXY_HOST`            = `https://<名字>.<子域>.workers.dev`（不带 /ai）
 *
 * ## 安全边界
 *
 * - 高德那一路只转发到 restapi.amap.com，只放行 /v3/ 开头的路径 → 不是开放代理。
 * - AI 那一路只收「两条消息、带我们自己的标记、长度有限」的请求，模型、max_tokens、
 *   温度全部写死在代码里 → 就算地址泄露也调不出一个通用的免费大模型。
 * - 每个 IP 每小时有次数上限，全站每天有总额度，超了就回 429 并说明原因。
 * - 密钥来自环境变量，代码里没有任何硬编码，日志里也不会打印它（包括出错时）。
 *
 * 注意：下面的限流计数存在 Worker 实例的内存里，是**尽力而为**的 ——
 * 同一个 IP 可能落在不同实例上，实际放行次数会比阈值略多。
 * 真要做精确配额得上 Durable Objects 或 KV，对这个小项目不值当。
 */

const AMAP_REST_HOST = 'https://restapi.amap.com'
const ALLOWED_PATH_PREFIX = '/v3/'
/** 高德要求代理地址的一级路由；转发前先把它剥掉 */
const SERVICE_ROUTE = '/_AMapService'

/* ------------------------------ AI 相关常量 ------------------------------ */

const AI_ROUTE_PREFIX = '/ai'
const AI_HEALTH_ROUTE = '/ai/health'
const AI_ADVICE_ROUTE = '/ai/fish-advice'

/** DeepSeek 官方接口；只连这一台，不做通用转发 */
const DEEPSEEK_HOST = 'https://api.deepseek.com'

/**
 * 我们自己打的标记：服务端用它确认「这是 LureMate 的推荐请求」，而不是
 * 随便什么人的通用调用。注意它本身不是安全边界（标记就在前端包里，
 * 想看的人能看到），真正的护栏是下面的限流和额度。
 * 与 src/lib/fish/ai/prompt.ts 的 AI_PROMPT_TAG、vite.config.ts 保持一致。
 */
const AI_PROMPT_TAG = 'LureMate::fish-advice::v1'

/** 默认模型；换模型的代价不同，所以留了一个环境变量口子，但默认不动它 */
const DEFAULT_AI_MODEL = 'deepseek-chat'
/** 输出上限写死：单次调用的成本就封在这里 */
const AI_MAX_TOKENS = 900
const AI_TEMPERATURE = 0.3
const AI_TIMEOUT_MS = 25_000

/** 请求体与提示词上限：只收一段提示词，用不着更大 */
const AI_MAX_BODY_BYTES = 32 * 1024
const AI_MAX_PROMPT_CHARS = 16_000

const DEFAULT_RATE_LIMIT_PER_HOUR = 20
const DEFAULT_DAILY_CAP = 500
const HOUR_MS = 3_600_000

/* ------------------------------ 跨域与回包 ------------------------------ */

/**
 * 允许跨域：前端页面在另一个域名（GitHub Pages）上。
 * 高德那一路固定 `*`（地址本身不是秘密，且高德接口没有成本风险）；
 * AI 那一路见 `aiCorsHeaders`，可以按来源白名单收窄。
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function textResponse(status, message) {
  return new Response(message, {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
  })
}

/** 白名单为空 = 不限制来源（并把这个事实说清楚，别让人以为设了） */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function aiCorsHeaders(request, env) {
  const list = allowedOrigins(env)
  const origin = request.headers.get('origin') ?? ''
  const allow = list.length === 0 ? '*' : list.includes(origin) ? origin : null
  if (!allow) return null
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  }
}

function jsonResponse(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  })
}

/* ------------------------------ 限流与额度 ------------------------------ */

/** IP → { start, count }，只保留当前这一小时窗口 */
const ipWindows = new Map()
/** 当天累计次数；进程重启会清零，所以它只是「拦得住」级别的护栏 */
let dailyCounter = { day: '', count: 0 }

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown'
}

/** 顺手清掉过期窗口，别让 Map 无限长大 */
function pruneWindows(now) {
  if (ipWindows.size < 4096) return
  for (const [ip, window] of ipWindows) {
    if (now - window.start >= HOUR_MS) ipWindows.delete(ip)
  }
}

/**
 * 记一次调用，返回 null 表示放行，否则返回一句给用户看的话。
 * 探活不算调用，不占额度。
 */
function takeQuota(request, env, now) {
  const limit = Number(env.RATE_LIMIT_PER_HOUR) || DEFAULT_RATE_LIMIT_PER_HOUR
  const cap = Number(env.DAILY_REQUEST_CAP) || DEFAULT_DAILY_CAP

  const day = todayKey()
  if (dailyCounter.day !== day) dailyCounter = { day, count: 0 }
  if (dailyCounter.count >= cap) {
    return '今天的 AI 推荐额度已经用完，明天再来；这次先用本地规则给你推荐。'
  }

  pruneWindows(now)
  const ip = clientIp(request)
  const window = ipWindows.get(ip)
  if (!window || now - window.start >= HOUR_MS) {
    ipWindows.set(ip, { start: now, count: 1 })
  } else if (window.count >= limit) {
    return `请求有点频繁了（每小时 ${limit} 次），歇一会儿再试；这次先用本地规则给你推荐。`
  } else {
    window.count += 1
  }

  dailyCounter.count += 1
  return null
}

/* ------------------------------ 请求体校验 ------------------------------ */

/** 读请求体并卡住体积；读不了或超限都返回 null */
async function readBody(request, limit) {
  const tooBig = await request
    .clone()
    .text()
    .then((text) => text.length > limit, () => true)
  if (tooBig) return null

  try {
    return await request.json()
  } catch {
    return null
  }
}

/** 只收两条消息，且 system 里必须带我们自己打的标记 */
function readMessages(body) {
  if (!body || typeof body !== 'object') return null
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length !== 2) return null

  const [first, second] = messages
  if (!first || first.role !== 'system' || typeof first.content !== 'string') return null
  if (!second || second.role !== 'user' || typeof second.content !== 'string') return null
  if (!first.content.includes(AI_PROMPT_TAG)) return null
  if (first.content.length + second.content.length > AI_MAX_PROMPT_CHARS) return null

  return { system: first.content, user: second.content }
}

/* ------------------------------ AI 两段路由 ------------------------------ */

async function handleAi(request, env, url, cors) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  const apiKey = env.DEEPSEEK_API_KEY

  // 探活：只说明「有没有配密钥」，不花额度、不打上游
  if (url.pathname === AI_HEALTH_ROUTE) {
    if (request.method !== 'GET') return jsonResponse({ ok: false, error: 'bad-request' }, 405, cors)
    return jsonResponse(
      {
        ok: true,
        enabled: Boolean(apiKey),
        model: apiKey ? (env.DEEPSEEK_MODEL ?? DEFAULT_AI_MODEL) : null,
        detail: apiKey ? null : '代理没有配置 DEEPSEEK_API_KEY，本次只给本地规则推荐。',
      },
      200,
      cors,
    )
  }

  if (url.pathname !== AI_ADVICE_ROUTE) {
    return jsonResponse({ ok: false, error: 'not-found' }, 404, cors)
  }
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'bad-request' }, 405, cors)
  }

  if (!apiKey) {
    return jsonResponse(
      {
        ok: false,
        error: 'no-key',
        message: '代理没有配置 DEEPSEEK_API_KEY，本次只给本地规则推荐。',
      },
      503,
      cors,
    )
  }

  const body = await readBody(request, AI_MAX_BODY_BYTES)
  const messages = readMessages(body)
  if (!messages) {
    return jsonResponse(
      { ok: false, error: 'bad-request', message: '请求格式不被接受。' },
      400,
      cors,
    )
  }

  const refusal = takeQuota(request, env, Date.now())
  if (refusal) {
    // 429 让客户端知道「是限流，不是坏了」，message 里说清是哪种
    return jsonResponse(
      { ok: false, error: 'rate-limited', message: refusal },
      429,
      cors,
    )
  }

  let upstream
  try {
    upstream = await fetch(`${DEEPSEEK_HOST}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 密钥只出现在这一跳，浏览器永远看不到它
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL ?? DEFAULT_AI_MODEL,
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
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: 'upstream',
        message: `调用 DeepSeek 失败：${error?.name ?? '未知错误'}`,
      },
      504,
      cors,
    )
  }

  if (!upstream.ok) {
    /*
     * 只回一句状态码，不回上游正文：上游的报错里可能带着请求信息，
     * 也免得把上游的提示词原样铺到前端。密钥和正文都不进日志。
     */
    return jsonResponse(
      { ok: false, error: 'upstream', message: `DeepSeek 返回 ${upstream.status}。` },
      502,
      cors,
    )
  }

  let data
  try {
    data = await upstream.json()
  } catch {
    return jsonResponse(
      { ok: false, error: 'upstream', message: 'DeepSeek 的返回读不出来。' },
      502,
      cors,
    )
  }

  const content = data?.choices?.[0]?.message?.content
  return jsonResponse(
    {
      ok: true,
      model: data?.model ?? env.DEEPSEEK_MODEL ?? DEFAULT_AI_MODEL,
      // 内容原样回传：id 是否在候选里、rating 是否合法，由前端 parse.ts 再校验一遍
      content: typeof content === 'string' ? content : '',
    },
    200,
    cors,
  )
}

/* ------------------------------ 高德那一路 ------------------------------ */

async function handleAmap(request, env, url) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return textResponse(405, '只支持 GET / POST。')
  }

  // 地址里带了 _AMapService 就剥掉；没带也照常工作（只是高德会在控制台唠叨）
  const pathname = url.pathname.startsWith(`${SERVICE_ROUTE}/`)
    ? url.pathname.slice(SERVICE_ROUTE.length)
    : url.pathname
  if (!pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    return textResponse(403, '这个代理只转发高德 /v3/ 服务请求。')
  }

  const securityCode = env.AMAP_SECURITY_CODE
  if (!securityCode) {
    return textResponse(
      500,
      '代理没有配置 AMAP_SECURITY_CODE：请用 wrangler secret put AMAP_SECURITY_CODE 设置。',
    )
  }

  const target = new URL(AMAP_REST_HOST)
  target.pathname = pathname
  target.search = url.search
  // 只在这里补密钥：前端拿到的查询串里没有 jscode
  target.searchParams.set('jscode', securityCode)

  const upstream = await fetch(target, {
    method: request.method,
    headers: { 'content-type': 'application/json' },
  })

  // 原样回传，不改内容：高德返回的错误码要能一路透到前端，方便定位问题
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === AI_ROUTE_PREFIX || url.pathname.startsWith(`${AI_ROUTE_PREFIX}/`)) {
      /*
       * 来源白名单只在配了 ALLOWED_ORIGINS 时才生效；没配就不限制，
       * 这样第一次部署不用先猜自己的域名。配了就按白名单来。
       */
      const cors = aiCorsHeaders(request, env)
      if (!cors) return textResponse(403, '这个来源不在允许列表里。')
      return handleAi(request, env, url, cors)
    }

    return handleAmap(request, env, url)
  },
}
