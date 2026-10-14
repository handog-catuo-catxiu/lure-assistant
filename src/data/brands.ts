import type { BrandEntry } from '../types/brand'

/**
 * 内置品牌库（中国大陆路亚品牌库 V1.0）。
 *
 * 这里只负责「品牌名称 / 别名 / Logo」三件事，和装备图鉴（具体产品型号）是两个
 * 独立模块，不要在这里生成产品数据。
 *
 * 匹配规则见 src/lib/brandLogo.ts 的 findBrand：
 * 先忽略大小写、空格和标点做精确匹配，再在 brand 里带了多余文字时做包含匹配。
 * 所以「禧玛诺」「SHIMANO」「禧玛诺 Shimano」都会归到同一条记录、用同一个 Logo。
 *
 * ## 别名怎么写
 *
 * 1. **不要编造英文名**。拿不准的（钓之猪、钓迷、梦辉、池刃、哈斯达等）只写中文，
 *    等核对到官方写法再补。别名写错会让不相干的装备被归到同一个品牌上。
 * 2. 规范名称本身也要写进 aliases，否则精确匹配那一步会漏掉它。
 * 3. **aliases 里第一个含拉丁字母的写法会被品牌选择器当作英文副标题**显示
 *    （「禧玛诺 Shimano」），所以把最规范的那个写法放在前面，比如 'Shimano' 在 'SHIMANO' 之前。
 *
 * ## 关于 Logo 素材
 *
 * 官方品牌 Logo 属于品牌方商标。当前处于本地开发测试阶段，登记的是从公开仓库取得的
 * **临时测试素材**，授权未核实，正式发布前必须逐个审核（见 public/brand-logos/CREDITS.md）。
 * logo.path 指向 public/brand-logos/ 下的本地文件：
 *   - 加载成功 → 显示真实 Logo；
 *   - 加载失败 → 自动回退到品牌文字 Logo，不会出现碎图。
 * 但**不要在文件还不存在时就登记**：那样每次加载都会先发一个无效请求、图片解码失败
 * 之后才回退，多一次无谓的闪烁。
 *
 * 当前哪些品牌有 Logo、目录里有没有放了文件却忘了登记的文件，跑一下就知道：
 *
 *   npm run check:logos
 */
export const BRANDS: BrandEntry[] = [
  /* ================= A. 重点品牌 ================= */
  {
    id: 'shimano',
    name: '禧玛诺',
    aliases: ['禧玛诺', '喜玛诺', '西马诺', 'Shimano', 'SHIMANO', 'shimano'],
    // 素材尚未取得，暂不登记 logo：登记了但文件不存在会先发一次无效请求再回退，
    // 不如直接显示文字占位。拿到 public/brand-logos/shimano.svg 后按 CREDITS.md 补上即可。
  },
  {
    id: 'daiwa',
    name: '达亿瓦',
    aliases: ['达亿瓦', '达瓦', 'Daiwa', 'DAIWA'],
    logo: {
      path: '/brand-logos/daiwa.svg',
      credit: 'detain/svg-logos（GitHub）— svg/d/daiwa.svg',
      license: '正式发布前待审核：仓库未声明许可，仅作本地测试素材（Trademarked）',
    },
  },
  // 钓之猪与钓之屋是两个不同品牌（见下面 B 组的 diaozhiwu），不要合并
  {
    id: 'diaozhizhu',
    name: '钓之猪',
    aliases: ['钓之猪'],
  },
  {
    id: 'diaomi',
    name: '钓迷',
    aliases: ['钓迷'],
  },
  {
    id: 'menghui',
    name: '梦辉',
    aliases: ['梦辉'],
  },
  {
    id: 'abu',
    name: '阿布',
    aliases: ['阿布', '阿布加西亚', 'Abu Garcia', 'ABU', 'abu garcia'],
    logo: {
      path: '/brand-logos/abu-garcia.svg',
      credit: 'detain/svg-logos（GitHub）— svg/a/abu-garcia.svg',
      license: '正式发布前待审核：仓库未声明许可，仅作本地测试素材（Trademarked）',
    },
  },
  {
    id: 'chiren',
    name: '池刃',
    aliases: ['池刃'],
  },
  {
    id: 'hasida',
    name: '哈斯达',
    // 英文写法没核实到官方信息，先只保留中文
    aliases: ['哈斯达'],
  },

  /* ================= B. 国产及中国市场常见品牌 ================= */
  {
    id: 'diaozhiwu',
    name: '钓之屋',
    aliases: ['钓之屋', 'Tsurinoya', 'TSURINOYA'],
  },
  {
    id: 'crony',
    name: '科尼',
    aliases: ['科尼', 'Crony', 'CRONY'],
  },
  {
    id: 'lingfeng',
    name: '领峰',
    aliases: ['领峰'],
  },
  {
    id: 'lurestar',
    name: '品钓',
    aliases: ['品钓', 'Lurestar', 'LURESTAR'],
  },
  {
    id: 'handing',
    name: '汉鼎',
    aliases: ['汉鼎', 'HANDING', 'H&ding', 'handing'],
  },
  {
    id: 'guangwei',
    name: '光威',
    aliases: ['光威', 'GW', 'Guangwei', 'guangwei'],
  },
  {
    id: 'kastking',
    name: '卡斯丁',
    aliases: ['卡斯丁', 'KastKing', 'kastking'],
  },
  {
    id: 'haibo',
    name: '海伯',
    aliases: ['海伯', 'Haibo', 'HAIBO'],
  },
  {
    id: 'yulieren',
    name: '鱼猎人',
    aliases: ['鱼猎人'],
  },
  {
    id: 'guowanglure',
    name: '国王路亚',
    aliases: ['国王路亚'],
  },
  {
    id: 'liemoren',
    name: '猎魔人',
    aliases: ['猎魔人'],
  },
  {
    id: 'jiadiaoni',
    name: '佳钓尼',
    aliases: ['佳钓尼'],
  },
  {
    id: 'tica',
    name: '迪佳',
    aliases: ['迪佳', 'Tica', 'TICA', 'tica'],
  },
  {
    id: 'woding',
    name: '沃鼎',
    aliases: ['沃鼎'],
  },

  /* ================= C. 国际及日系常见品牌 ================= */
  {
    id: 'megabass',
    name: 'Megabass',
    aliases: ['Megabass', 'megabass', '目影'],
  },
  {
    id: 'jackall',
    name: 'JACKALL',
    aliases: ['JACKALL', 'Jackall', 'jackall'],
  },
  {
    id: 'duo',
    name: 'DUO',
    aliases: ['DUO', 'Duo', 'duo'],
  },
  {
    id: 'majorcraft',
    name: 'Major Craft',
    aliases: ['Major Craft', 'MajorCraft', 'majorcraft'],
  },
  {
    id: 'rapala',
    name: '乐伯乐',
    aliases: ['乐伯乐', 'Rapala', 'rapala'],
    // 同禧玛诺：素材未取得，先显示文字占位
  },
  {
    id: 'osp',
    name: 'O.S.P',
    aliases: ['O.S.P', 'O.S.P.', 'OSP'],
  },
  {
    id: 'evergreen',
    name: 'Evergreen',
    aliases: ['Evergreen', 'evergreen'],
  },
  {
    id: 'zipbaits',
    name: 'ZIPBAITS',
    aliases: ['ZIPBAITS', 'ZipBaits', 'Zip Baits', 'zipbaits'],
  },
  {
    id: 'gancraft',
    name: 'Gan Craft',
    aliases: ['Gan Craft', 'GanCraft'],
  },
  {
    id: 'okuma',
    name: '宝熊',
    aliases: ['宝熊', 'Okuma', 'okuma'],
  },
  {
    id: 'berkley',
    name: '贝克力',
    aliases: ['贝克力', 'Berkley', 'berkley'],
  },
  {
    id: 'penn',
    name: 'PENN',
    aliases: ['PENN', 'Penn', 'penn'],
  },
  {
    id: 'zman',
    name: 'Z-Man',
    aliases: ['Z-Man', 'ZMan', 'zman'],
  },

  /* ============ D. 之前已登记、继续保留的其它品牌 ============ */
  {
    id: 'bee',
    name: '小蜜蜂',
    aliases: ['小蜜蜂'],
  },
  {
    id: 'shimi',
    name: '诗蜜',
    aliases: ['诗蜜'],
  },
  {
    id: 'luckycraft',
    name: 'Lucky Craft',
    aliases: ['Lucky Craft', 'LuckyCraft'],
  },
  {
    id: 'deps',
    name: 'Deps',
    aliases: ['Deps'],
  },
  {
    id: 'keitech',
    name: 'Keitech',
    aliases: ['Keitech'],
  },
  {
    id: 'yamamoto',
    name: 'Gary Yamamoto',
    aliases: ['Gary Yamamoto', 'Yamamoto'],
  },
  {
    id: 'yozuri',
    name: 'Yo-Zuri',
    aliases: ['Yo-Zuri', 'YoZuri', 'DUEL'],
  },
  {
    id: 'gamakatsu',
    name: '伽玛卡兹',
    aliases: ['伽玛卡兹', 'Gamakatsu'],
  },
  {
    id: 'owner',
    name: '欧娜',
    aliases: ['欧娜', 'Owner'],
  },
  {
    id: 'toray',
    name: '东丽',
    aliases: ['东丽', 'Toray'],
  },
  {
    id: 'varivas',
    name: 'Varivas',
    aliases: ['Varivas'],
  },
  {
    id: 'ygk',
    name: 'YGK',
    aliases: ['YGK', 'ygk'],
  },
  {
    id: 'seaguar',
    name: 'Seaguar',
    aliases: ['Seaguar', 'seaguar'],
  },
  {
    id: 'sunline',
    name: 'Sunline',
    aliases: ['Sunline', 'sunline'],
  },
  {
    id: 'ximanduo',
    name: '喜曼多',
    aliases: ['喜曼多'],
  },
  {
    id: 'wolfking',
    name: '狼王',
    aliases: ['狼王', 'Wolf King'],
  },
]
