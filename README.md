# 路亚助手 LureMate

路亚出勤记录：装备管理、钓点、出勤、一键上鱼、GPS 轨迹与轨迹回放。
React + TypeScript + Vite，手机端优先。数据先写本机（localStorage + IndexedDB），
登录后可增量同步到 CloudBase；未登录或断网时照常使用。

地图和定位用的都是**高德 JS API 2.0**（原先的 Leaflet + OpenStreetMap、浏览器原生
`navigator.geolocation` 都已经移除，全项目只有一套定位）。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173/
npm run lint
npm run build
```

## 高德地图接入（需要自己配一次）

地图不配也能跑，只是地图区域会显示一句「还没有配置高德地图 Key」，
其它功能（出勤、渔获、装备、轨迹记录）完全不受影响。

### 1. 申请 Key

1. 打开 [高德开放平台控制台](https://console.amap.com/dev/key/app)，注册并完成个人实名认证（免费）。
2. 「应用管理 → 我的应用 → 创建新应用」。
3. 在应用下「添加 Key」：
   - **Key 名称**：随便起，例如 `LureMate Web`
   - **服务平台**：必须选 **Web 端 (JS API)**
   - **域名白名单**：填线上访问的域名，例如 `你的用户名.github.io`
     （本地开发不受白名单限制；只有线上域名写对了，线上地图才出得来）
4. 记下两串东西：
   - **Key**（形如 `1a2b3c...`）—— 公开信息
   - **安全密钥**（在 Key 的详情里，形如 `a1b2c3...`）—— **不能公开**

### 2. 配置本地开发

```bash
cp .env.example .env.local
```

在 `.env.local` 里填：

```
VITE_AMAP_KEY=你的Key
AMAP_SECURITY_CODE=你的安全密钥
```

- `VITE_AMAP_KEY` 会被打进前端代码，这是正常的：高德靠**域名白名单**保护它。
- `AMAP_SECURITY_CODE` **故意不带 `VITE_` 前缀**，只在开发服务器（Node 侧）读取，
  由 `vite.config.ts` 里的本地代理在转发服务请求时补上。
  写成 `VITE_AMAP_SECURITY_CODE` 就等于把密钥公开在网页源码里。
- `.env.local` 已被 `.gitignore` 忽略，不会提交。

改完 `.env.local` 要**重启** `npm run dev`（环境变量只在启动时读一次）。

### 3. 线上（GitHub Pages）

线上没有 Node 侧可以藏密钥，必须部署一台代理：

1. 按 [`proxy/README.md`](proxy/README.md) 部署代理服务（Cloudflare Worker，免费额度足够）。
2. 在仓库网页 `Settings → Secrets and variables → Actions → Variables` 里加两个**变量**：
   - `VITE_AMAP_KEY` = 你的 Key
   - `VITE_AMAP_SECURITY_PROXY_HOST` = 代理域名，例如 `https://luremate-amap-proxy.xxx.workers.dev`
     （路径不用手写：前端会把它规范化成高德要求的 `/_AMapService/v3/...`）
3. 部署工作流会自动把它们注入构建（见 `.github/workflows/deploy.yml`）。
   安全密钥**只存在于代理服务里**，不进仓库、不进 CI。

没有第 2 步里的代理时：线上只能显示底图、轨迹和标记，地名识别与地点搜索会明确提示缺代理，
可以让用户手写地名。

## CloudBase 账号登录与云同步

「我的」页支持中国大陆手机号（+86）验证码登录，未注册的手机号验证通过后会自动创建账号。
登录后「我的」页只显示脱敏号码（例如 `138****8000`），身份以 `session.user.id`
（CloudBase UID）为准，手机号只用于展示。

登录后会把以下**真实用户数据**增量同步到 CloudBase（PostgreSQL + 对象存储）：

- 个人装备（含官方装备 id 关联、购买日期、备注等用户自己的字段）
- 装备照片
- 钓点、出勤、渔获
- 渔获照片
- 出勤 GPS 轨迹点
- 首页「参考钓点 / 水型」两个跨设备偏好

天气、地图、页面状态、AI 推荐结果等临时数据不同步。官方装备目录是公共只读数据，
不会复制到每个用户账号里。

### 本机数据与账号隔离

- 未登录且从未导入过：继续使用原有键名（`luremate:gear:v1` 等），本机数据归属不明。
- 登录后：所有本地数据按 UID 分库分键（`luremate:u:<uid>:`、`luremate-u_<uid>`），
  不同账号互相看不到；退出登录后进入 `guest` 范围，也不再展示上一个账号的数据。
- **登录不会自动上传旧的本机数据。** 「我的」页会提示「导入本机数据」，
  只有用户主动点击才会执行；导入是**复制**，旧数据原样保留，失败可重试。
- 导入按 id 合并、重复执行不会重复上传；装备/出勤/渔获之间的 id 引用保持不变。
- 这份本机旧数据一旦被某个账号导入，另一个账号不能再导入同一份；
  但旧键名本身始终不删除。

### 同步行为

- 本机修改先落盘，再登记待上传；断网时保留，联网后自动重试。
- 删除使用墓碑（`deleted_at`），不会因为「本地没有」就把云端记录误删。
- 拉取是增量的（服务端游标），冲突按 `client_updated_at` 的「后写者胜」处理；
  数据库触发器也会拒绝比现有行更旧的更新，避免慢时钟设备覆盖新数据。
- 图片上传成功但数据库写入失败、或数据库成功但图片失败，都会保留待重试状态。
- 「我的」页顶部显示同步状态：同步中 / 已同步 / 等待网络 / 同步失败（可手动重试）。
  只保存在本机时会明确提示「已保存在本机，等待同步。」

### 官方装备目录

官方装备单独存放在 `catalog_brands` / `catalog_series` / `catalog_gear` /
`catalog_gear_variants` / `catalog_sources`，和用户个人装备表分开：

- 所有登录用户只能读 `review_status = 'approved'` 且未下架的记录；
  普通用户不能新增、修改、删除官方数据（RLS + 管理函数双重限制）。
- 列表走服务端分页、关键词搜索和分类筛选，不一次性下载整个目录；
  浏览过的页面缓存在本机，可离线查看。
- 装备关联的是稳定的 `gear-...` 官方 ID；用户自己的购买信息、备注、照片存在个人表，
  官方资料更新不会覆盖个人字段，官方下架也不会删除用户的装备。
- 新品牌、新型号通过 CSV 批量导入，不需要发版：
  模板见 `cloudbase/catalog/catalog.template.csv`，完整说明见
  [`cloudbase/catalog/README.md`](cloudbase/catalog/README.md)。
- 导入的数据默认 `pending_review`，必须人工审核后才能公开；
  带图片的记录必须同时提供 `source_url` 和图片授权状态，不默认抓取、发布第三方图片。

代码使用 CloudBase Auth v3（PostgreSQL 环境推荐接口）：

- 发送验证码 / 自动注册：`auth.signInWithOtp({ phone })`，保存返回的 `data.verifyOtp`
- 校验验证码并登录：`data.verifyOtp({ token })`
- 恢复会话：`auth.getSession()`，`data.session` 为空表示未登录
- 退出：`auth.signOut()`

不使用 v2 的 `getVerification` / `signInWithEmail` / `getLoginState` / `getCurrentUser`。
账号身份以 `session.user.id`（CloudBase UID）为准，手机号只用于展示；
云同步的数据归属同样只认 UID，不使用手机号。
前端只带公开的环境 ID 和 Publishable Key，不需要也不允许配置 SecretId / SecretKey。

### 控制台配置（需要手动确认一次）

1. 云开发控制台 → 身份认证 → 登录方式：确认「短信验证码」已开启。
   使用默认短信通道即可，不需要另外配置短信签名、模板或自定义服务商；
   只有要自定义签名/模板时，才需要在该页面继续配置。
2. 确认账号有可用的短信额度/资源包。额度不足时，登录界面会提示「短信发送额度不足」。
3. 环境设置 → 安全配置 → **Web 安全域名**，逐个添加：
   - `handog-catuo-catxiu.github.io`（线上 GitHub Pages）
   - `localhost:5173`（本地 Vite）
   - `127.0.0.1:5173`
   - 如果本地换了端口（例如 `5201`），那个端口也要单独加。

   安全域名**不要带 `https://`、不要带路径**，也不支持通配符；
   没加时登录请求会被拒绝（常见错误码 `INVALID_REQUEST_SOURCE`）。
4. 控制台创建 **Publishable Key**（数据库/对象存储的公开客户端凭据），
   填到前端环境变量 `VITE_PUBLISHABLE_KEY`。它会被打包进前端，这是官方设计；
   **SecretId / SecretKey / Service Role / 数据库管理员密码绝不能出现在前端或仓库里。**

### 数据库与对象存储初始化（需要手动执行一次）

SQL 文件都在 `cloudbase/sql/`，**按顺序执行**：

| 顺序 | 文件 | 作用 |
| --- | --- | --- |
| 1 | `001_catalog.sql` | 官方装备目录、规格版本、来源、审核状态、公共只读 RLS |
| 2 | `002_user_data.sql` | 个人装备/钓点/出勤/渔获/轨迹/偏好/图片元数据，UID 行级隔离 |
| 3 | `003_storage.sql` | 私有用户图片桶、公开官方图片桶及路径级权限 |
| 4 | `004_catalog_review.sql` | 管理员审核/发布函数（拒绝普通用户） |

在 CloudBase 控制台的 PostgreSQL 里依次执行，或用 CLI（需先登录并确认目标环境）：

```bash
npx --yes --package @cloudbase/cli@3.8.7 tcb db execute \
  --envId luremate-d5gilu0y4efa3b802 --role postgres \
  --sql "$(cat cloudbase/sql/001_catalog.sql)"
```

每个文件都是可重复执行的（`if not exists` / `drop policy if exists`），
但**首次执行前请先备份并确认环境**。对象存储会在 `003_storage.sql` 中创建两个桶：

- `luremate-user-media`（私有）：路径第一段必须是 UID，用户只能读写自己的目录；
- `luremate-catalog`（公开读）：只由管理员导入官方图片，前端不能写入。

官方目录 CSV 导入流程见 `cloudbase/catalog/README.md`；
导入脚本只生成 SQL，不直接连数据库：

```bash
node scripts/import-catalog-csv.mjs --dry-run
node scripts/import-catalog-csv.mjs
```

### 环境变量

前端内置了默认环境 ID `luremate-d5gilu0y4efa3b802`，本地通常不用配。
需要指向别的环境时，在 `.env.local` 或仓库 Actions Variables 里设置：

```
VITE_CLOUDBASE_ENV_ID=你的环境ID
VITE_PUBLISHABLE_KEY=你的PublishableKey
VITE_USER_MEDIA_BUCKET=luremate-user-media
VITE_CATALOG_BUCKET=luremate-catalog
```

两个桶名不填时使用上面的默认值；GitHub Actions 里没有传桶名时也会用默认值。
环境 ID、Publishable Key 和桶名都会出现在前端代码里，属于公开信息；
SecretId / SecretKey 绝不能放进前端。

## 定位说明（改代码前请先看这段）

全项目只有**一套定位**：`AMap.Geolocation`，包在 `src/lib/amap/geolocation.ts` 里。
GPS 卡片、轨迹、标点定位、渔获补位置用的都是它吐出来的同一条读数
（`useCurrentLocation` 一次性 / `useGeoWatcher` 持续），不存在第二条并行的定位链路。

- **不直接用它自带的 `watchPosition`**：高德那个 watch 内部是个 10 秒轮询，
  而且 `clearWatch()` 之后实例就再也起不来了（暂停 → 继续会静默失效）。
  所以这里自己按同样的 10 秒节奏调 `getCurrentPosition`，暂停/继续/重开都可控，
  并且保证全程只有一条循环（换页面、刷新都会重新接上，不会叠加监听）。
- **设备定位 vs IP 大致位置**：高德拿不到设备定位时会退回 IP 定位。
  这种读数统一标上 `source: 'ip'`，界面上写成「IP 大致位置」，
  并且**所有入库路径都会拒绝它**（标点、渔获、轨迹、上次定位记录都不会写）。
  它只能在地图上当个参考。
- **不显示无限「定位中」**：单次定位有 25 秒兜底超时，持续定位有 40 秒无读数看门狗，
  到点就转成可见的失败 + 「重新尝试定位」。
- **断档如实处理**：iPhone 锁屏 / 切后台期间网页定位会被挂起，回来之后轨迹就是断开一段。
  断点不插值、不补点、不算距离（`TRACK_GAP_MS`），界面上也会说明。
- **上次定位**：这次没拿到新读数时，界面会把已有的那条写成「上次定位」并带时间，
  绝不摆在「当前坐标」的位置上冒充。

## 坐标系说明（改代码前请先看这段）

- **存进数据里的一律是 WGS84**，也就是手机 GPS 的原始经纬度。
  标点、渔获、轨迹点、上次定位记录都是这一套。
- **高德地图要的是 GCJ-02**（国测局坐标）。两者在中国大陆相差几百米，
  直接拿去画图就是整条轨迹整体偏移。
- 转换只发生在**上下地图的那一瞬间**，全项目只有两个函数：
  `src/lib/coord.ts` 里的 `toMapLngLat()`（上地图）和 `fromMapLngLat()`（地图选点 / 高德定位转回存储）。
  任何地方都不要再手写一次转换，否则会「转两次」。
- 高德定位吐出来的坐标是哪一套，由 `resolveConverted()` 判断：
  设备定位默认给的是 WGS84（高德的坐标转换服务没通时也是），
  而 IP 定位给回来的**已经是 GCJ-02**。只有确认是 GCJ-02 才调 `fromMapLngLat()`，
  其余原样存，避免同一个点被转换两次。
- 历史数据全部是 WGS84，不需要迁移，也不要去改。

## 目录速览

```
src/lib/coord.ts             坐标系转换（WGS84 ↔ GCJ-02），全项目唯一的转换点
src/lib/amap/config.ts       高德配置：Key、代理地址、缺配置时的人话提示
src/lib/amap/loader.ts       动态加载 JS API 2.0，设置安全密钥代理（不设置 securityJsCode）
src/lib/amap/geolocation.ts  统一定位服务：单次定位 + 唯一一条持续定位循环
src/lib/amap/geocode.ts      逆地理编码 + POI 搜索（自动识别地名、地点搜索）
src/hooks/useGeolocation.ts  定位的两个入口：useCurrentLocation / useGeoWatcher
src/components/TripMap.tsx   高德底图 + 轨迹 + 标点/渔获/当前位置标记
src/components/MapPicker.tsx 地图选点弹窗（点地图 / 搜索地点）
src/lib/geo.ts               距离、精度过滤、轨迹断点、展示格式
vite.config.ts               开发环境的高德安全密钥代理
proxy/                       生产环境的安全密钥代理（Cloudflare Worker）
```

地图加载失败、没配 Key、断网，都只影响地图那一块：出勤、上鱼、轨迹记录照常可用。
定位失败同样不影响出勤：轨迹会从拿到定位那一刻才开始记。
