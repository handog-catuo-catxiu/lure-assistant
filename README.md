# 路亚助手 LureMate

路亚出勤记录：装备管理、钓点、出勤、一键上鱼、GPS 轨迹与轨迹回放。
React + TypeScript + Vite，手机端优先，数据全部存在本机（localStorage + IndexedDB）。

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
