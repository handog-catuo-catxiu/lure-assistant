# 品牌 Logo 素材来源与授权记录

本目录存放首页装备列表左侧使用的品牌 Logo。

> ⚠️ **当前所有素材都是本地开发测试用的临时素材，授权尚未核实。**
> **正式发布（上架 / 对外分享）之前必须逐个审核一遍，把不合适的删掉。**

本项目处于「先保证功能完整、界面美观，版权细节后面再统一处理」的阶段
（见需求一）。所以素材来源简单记录如下，不逐张深究条款。

---

## 一、当前已收录

| 文件名 | 品牌 | 来源 | 授权状态 | 已核实 |
| --- | --- | --- | --- | --- |
| `daiwa.svg` | Daiwa / 达亿瓦 / 达瓦 | GitHub 仓库 `detain/svg-logos`，路径 `svg/d/daiwa.svg` | ⚠️ 该仓库**未声明任何许可**，仅作临时测试素材 | ❓ 待审核 |
| `abu-garcia.svg` | Abu Garcia / 阿布 | GitHub 仓库 `detain/svg-logos`，路径 `svg/a/abu-garcia.svg` | ⚠️ 该仓库**未声明任何许可**，仅作临时测试素材 | ❓ 待审核 |

两个文件都是纯 `<path>` 的 SVG，已检查过不含 `<script>`、`onload`、`<foreignObject>`
或任何外部引用。

**正式发布前要做的**：换成品牌官网 / 官方媒体资源库的素材，或直接删除、
让界面回退到品牌文字占位。用之前请确认各自的使用条款。

## 二、暂时没有 Logo 的品牌

这些品牌在界面上一律显示**品牌文字或缩写**（例如 `禧玛诺 → 禧`、`DUO → DUO`），
不冒充任何官方标识。

清单不写死在这里（品牌表一改就过时），跑一下就能看到当前状态：

```bash
npm run check:logos
```

输出会分四段：已有真实 Logo 的品牌及其文件名、暂无 Logo 的品牌、
目录里放了却忘了登记的文件、登记表本身的问题（文件不存在、别名冲突等）。
登记了不存在的文件时会以非零状态退出，方便以后接进 CI。

### 品牌库扩到 51 个之后的取材情况（2026-10-15）

「中国大陆路亚品牌库 V1.0」把品牌表扩到了 51 个，为新增品牌又找过**两轮**素材，
都没拿到可用的，于是全部保留文字占位（按需求：不要为了找 Logo 长时间卡住）：

| 轮次 | 来源 | 结果 |
| --- | --- | --- |
| 1 | `detain/svg-logos` 全量文件清单（86,154 个 SVG，`api.github.com` 一次请求） | 除已有的 `daiwa.svg`、`abu-garcia.svg` 外，**没有** Shimano / Rapala / Berkley / KastKing / Megabass / JACKALL / YGK / Seaguar / Sunline / Gamakatsu / 东丽 / Varivas / Yo-Zuri / 钓之屋 / 海伯 等钓具品牌；`okuma*.svg` 仍是机床公司那一个，不采用；`duo-*.svg`、`evergreen-*.svg`、`lucky-*.svg` 都指向同名但**不相干**的公司，不采用 |
| 2 | `simple-icons` npm 包（`unpkg.com`，20 个 slug 探测） | 一个都没有 |

`scripts/fetch-brand-logos.sh` 里那条 Wikimedia Commons 的路子在本机也走不通
（`upload.wikimedia.org` 连接超时，刚才实测返回 `000`）。
**如果你在自己的终端里能上外网**，跑一下这个脚本就可能把 `shimano.svg`、`rapala-logo.svg`
取回来；取回来之后按第四节登记即可，`BrandTile` 会自动开始显示。

### 几个已经查过、但**不要用**的素材

| 素材 | 为什么不能用 |
| --- | --- |
| `detain/svg-logos` 里的 `daiwa-bank.svg` / `daiwa-house.svg` / `daiwa-capital-markets*.svg` | 是**别的公司**（大和银行 / 大和房屋 / 大和证券），不是渔具品牌达亿瓦 |
| `detain/svg-logos` 里的 `daiwa-2.svg` | 渲染出来是 **DAIWA ROYAL HOTEL**（酒店），不是渔具品牌 |
| `detain/svg-logos` 里的 `okuma.svg` / `okuma-corporation*.svg` | 宝熊的官方标识是「北极熊 / 海浪」意象，这两个文件渲染成钩形，且文件名指向**机床公司 Okuma Corporation**，无法确认是渔具品牌，故未采用 |
| `detain/svg-logos` 里的 `duo-1.svg` / `duo-fast.svg`、`evergreen-2.svg` 等 | 文件名只是**同名的不相干公司/产品**，无法确认是钓具品牌 DUO、Evergreen，不采用 |
| Wikimedia Commons 上的 `DAIWA logo.svg` | 同样是**百货公司 Daiwa** |
| 各类第三方 Logo 聚合站（Brandfetch、logos 合集等） | 均声明保留全部权利，不能作为产品资源 |

## 三、代码里怎么登记的

登记位置：`src/data/brands.ts`，给对应品牌加 `logo` 字段：

```ts
logo: {
  path: '/brand-logos/daiwa.svg',
  credit: 'detain/svg-logos（GitHub）— svg/d/daiwa.svg',
  license: '正式发布前待审核：仓库未声明许可，仅作本地测试素材（Trademarked）',
}
```

**关键规则：文件不存在就不要写 `logo` 字段。**
登记了但文件不存在时，浏览器会先请求一次、失败之后才回退到文字占位，
白闪一下。禧玛诺和 Rapala 现在就是「素材没拿到 → 不登记 → 直接显示文字」。

这条规则由 `npm run check:logos` 兜底：脚本会把 `src/data/brands.ts` 里登记过的
每个路径都去 `public/brand-logos/` 里确认一遍，文件缺失就报错退出。

## 四、以后补素材的步骤

1. 把 SVG 或透明背景 PNG 放进本目录，文件名用 `<品牌id>.<后缀>`
   （`id` 与 `src/data/brands.ts` 里的 `id` 一致，例如 `shimano.svg`）。
   SVG 优先，`BrandTile` 用 `object-fit: contain` 显示，两种格式都不会变形。
2. 在 `src/data/brands.ts` 对应品牌上补 `logo` 字段（见上）。
3. 在本文第一节的表格里补一行。
4. 跑 `npm run check:logos` 确认路径没写错、文件确实在。
5. 重启开发服务器：`npm run dev` 只在**启动时**扫描一次 `public/`，
   之后新加的文件访问不到。正式构建同理，要重新 `npm run build` 才会复制进 `dist/`。

如果只是想从 Commons 抓那几个候选文件，项目里备了一个脚本：

```bash
bash scripts/fetch-brand-logos.sh          # 已存在的文件会跳过
bash scripts/fetch-brand-logos.sh --force  # 重新下载
```

> 脚本下载的是 Wikimedia Commons 上的 `Shimano.svg` 和 `Rapala Logo.svg`
> （预期为 `PD-textlogo`，即「不构成著作权的简单文字商标」）。
> **本项目的开发环境没有外网，脚本需要在你自己的终端里跑。**

## 五、使用边界

- 品牌 Logo 是**商标**，即使不构成著作权，使用范围也要限于
  「标明这件装备是哪个品牌的」，属于指称性使用。
- 不要把 Logo 当作本项目的标识，也不要用在宣传本应用的场景里。
- 拿不准的素材：不放进这个目录，用品牌文字缩写
  （`src/lib/brandLogo.ts` 会自动处理）。
