# 服务端代理（Cloudflare Worker）

这个目录放的是**生产环境**用的代理服务，一份代码同时干两件事：

| 接口 | 干什么 | 需要哪个密钥 |
| --- | --- | --- |
| `/_AMapService/v3/...` | 给高德的服务类请求补上安全密钥 `jscode` 再转发 | `AMAP_SECURITY_CODE` |
| `/ai/health`、`/ai/fish-advice` | 代前端调用 DeepSeek，做首页的鱼种排序 | `DEEPSEEK_API_KEY` |

开发环境用的是 `vite.config.ts` 里的本地中间件，功能一一对应，不需要部署任何东西。

一句话说明它为什么存在：

> 高德规定逆地理编码、POI 搜索这类请求必须带**安全密钥**；DeepSeek 的 API Key
> 更是绝对不能出现在浏览器里。密钥写进前端源码就等于公开（Vite 的 `VITE_` 变量
> 也会被一起打进产物），所以这两类请求都先经过一台**代理服务器**，
> 由代理补上密钥再转发。密钥只存在于代理的环境变量中，前端和 Git 仓库里都看不到。

## 需要部署吗？

| 场景 | 需要代理吗 | 说明 |
| --- | --- | --- |
| 本地开发（`npm run dev`） | 不用 | `vite.config.ts` 里的本地中间件，密钥读 `.env.local` |
| 线上只看底图、只用本地规则的推荐 | 不用 | 只填 `VITE_AMAP_KEY` 就够 |
| 线上要「自动识别地名 / 搜索地点」 | 需要 | 高德那一路 |
| 线上要 AI 排序的鱼种推荐 | 需要 | AI 那一路 |

没有代理时 App 不会假装成功：地名查询提示「未配置代理」（可以手动填地名），
鱼种推荐退回本地规则并写明「这次没用到 AI」。

## 部署步骤（免费额度足够个人使用）

```bash
# 1. 准备 wrangler（Cloudflare 官方 CLI，不需要付费账号）
npx wrangler login

# 2. 在 proxy/ 目录下部署
cd proxy
npx wrangler deploy --name luremate-proxy

# 3. 把两个密钥写进 Worker 的环境变量（不会落到任何文件里）
npx wrangler secret put AMAP_SECURITY_CODE
npx wrangler secret put DEEPSEEK_API_KEY
```

可选的环境变量（`wrangler secret put` 或 `wrangler.toml` 的 `[vars]`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | 不限制 | 逗号分隔的来源白名单，例如 `https://你的用户名.github.io`。**建议设置** |
| `RATE_LIMIT_PER_HOUR` | 20 | 每个 IP 每小时能调几次 AI |
| `DAILY_REQUEST_CAP` | 500 | 全部用户每天能调几次 AI（费用总闸） |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 换模型会改变单价，默认别动 |

部署完成后会得到一个地址，例如 `https://luremate-proxy.<你的子域>.workers.dev`，
把它填进项目根目录的 `.env.local`（线上的话填进 GitHub 仓库的 Variables）：

```
# 高德：带不带 /_AMapService 都行，前端会补成规范形状
VITE_AMAP_SECURITY_PROXY_HOST=https://luremate-proxy.<你的子域>.workers.dev

# AI：只要域名，不要带 /ai 后缀
VITE_AI_PROXY_HOST=https://luremate-proxy.<你的子域>.workers.dev
```

> 高德 SDK 会检查代理地址的一级路由，不是 `_AMapService` 就会在控制台连篇抱怨
> （页面跑在 localhost 上时甚至直接弹 alert 挡住页面）。所以前端在交给 SDK 之前
> 会统一把它规范成 `{你的域名}/_AMapService`，请求长这样：
> `{你的域名}/_AMapService/v3/geocode/regeo?...`。
> `worker.js` 转发前会把这一段剥掉，后面的路径全部由它自己决定。

然后重新 `npm run build` 并发布。

## AI 那一路是怎么控制的

- **模型、`max_tokens`、温度都写死在 Worker 里**，前端传什么都没用，
  所以这个地址即使泄露，也变不成一个通用的免费大模型接口。
- **只接受我们自己发的请求**：请求体必须是两条消息、system 里带
  `LureMate::fish-advice::v1` 这个标记、总长度不超过 16000 字，否则直接 400。
  这个标记本身不是安全边界（它就在前端包里），真正的护栏是下面两条。
- **限流**：每个 IP 每小时默认 20 次，超了回 429 并说明原因；
  **额度**：全站每天默认 500 次，用满就停止调用，前端退回本地规则。
- **前端还有一层**：同一片水域 + 同一档天气 3 小时内只调一次（结果缓存在浏览器里），
  手动重试至少间隔 60 秒，条件还在变化时不会发请求。
- 计数存在 Worker 实例的内存里，属于**尽力而为**：同一时刻多个实例时，
  实际放行会略多于阈值。要精确配额得上 Durable Objects 或 KV，这个小项目没必要。

## 这个代理的安全边界

- **高德那一路只转发高德**：目标域名写死在代码里，且只放行 `/v3/` 开头的路径。
- **AI 那一路只转发 DeepSeek 的 `/chat/completions`**：路径同样写死。
- **密钥只存在环境变量里**：代码里没有任何硬编码，出错时也不打印密钥，
  上游的报错正文不会被透传给前端。
- **允许跨域**：页面部署在 GitHub Pages，和 Worker 不同源；
  配了 `ALLOWED_ORIGINS` 之后只对白名单里的来源放行。
- **不缓存**：每次请求都实时转发。

## 为什么密钥不能走 `VITE_` 变量

Vite 会把所有 `VITE_` 开头的变量**内联进最终的 JS 文件**。也就是说，
`VITE_DEEPSEEK_API_KEY=xxx` 写进 `.env.local` 之后，
任何人在浏览器里查看打包产物都能读到它 —— 这不是「保护」，只是把密钥换了个地方放。
所以本项目的两个密钥变量 `AMAP_SECURITY_CODE` 和 `DEEPSEEK_API_KEY`
**故意不带 `VITE_` 前缀**，只在服务端（开发中间件 / Worker）读取。

## 本地开发时它从哪拿 Key

`npm run dev` 时 AI 请求由 `vite.config.ts` 里的本地中间件转发，密钥按这个顺序找：

1. `.env.local` 里的 `DEEPSEEK_API_KEY`；
2. 没有的话，如果 `ANTHROPIC_BASE_URL` 指向 `https://api.deepseek.com`
   （也就是 Claude Code 本身正跑在 DeepSeek 官方接口上），就**就地复用**它的
   `ANTHROPIC_AUTH_TOKEN` —— 不复制、不落盘、不打印，dev server 一停就没了。
   域名对不上就不会去动它。

改完 `.env.local` 要重启 dev server 才会生效。
