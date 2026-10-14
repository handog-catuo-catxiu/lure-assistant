import type { CatalogProduct } from '../types/catalog'

/**
 * 装备图鉴示例目录。
 *
 * 说明：
 * - 这是「少量示例数据」，用于验证「搜索产品 → 自动填充」的功能，正式收录前
 *   每个型号的规格都需要按厂商官方参数逐条核对。
 * - 所有产品目前都不带 photo 字段：本项目没有可确认授权的真实产品照片，
 *   不抓取第三方图片、也不使用外部图片链接，因此界面统一显示分类示意图。
 *   将来拿到授权图片后，把文件放进 public/catalog/ 并补上 photo 字段即可，
 *   界面会自动优先显示它，并在图片上标注来源。
 * - 分类支持鱼竿 / 渔轮 / 拟饵 / 周边装备四种（见 GearCategory）。周边装备
 *   暂时**不放示例产品**：周边的型号（某某包、某某钳）属于具体商品，没有核实过的
 *   信息就不编。以后要给周边装备补产品，往下面这个数组里追加即可，
 *   category 写 'accessory'，规格用 { accessoryType: '路亚包' }（取值见 ACCESSORY_TYPES），
 *   图鉴的选择框、分类筛选、自动填充和搜索都会自动带上它。
 */
export const CATALOG: CatalogProduct[] = [
  // 鱼竿
  {
    id: 'cat-rod-daiwa-mx-s610ml',
    brand: '达亿瓦',
    name: '月影 MX S610ML 直柄',
    category: 'rod',
    spec: { length: '2.08m', action: 'ML调' },
  },
  {
    id: 'cat-rod-daiwa-mx-s662ml',
    brand: '达亿瓦',
    name: '月影 MX S662ML 直柄',
    category: 'rod',
    spec: { length: '1.98m', action: 'ML调' },
  },
  {
    id: 'cat-rod-shimano-shaula-166ml2',
    brand: '禧玛诺',
    name: 'World Shaula 166ML-2',
    category: 'rod',
    spec: { length: '1.98m', action: 'ML调' },
  },
  {
    id: 'cat-rod-abu-veritas-70m',
    brand: '阿布',
    name: 'Veritas VRTSP70M 枪柄',
    category: 'rod',
    spec: { length: '2.13m', action: 'M调' },
  },

  // 渔轮
  {
    id: 'cat-reel-daiwa-mx-2500s',
    brand: '达亿瓦',
    name: '月影 MX 2500S',
    category: 'reel',
    spec: { model: '2500S', ratio: '5.2:1' },
  },
  {
    id: 'cat-reel-daiwa-mx-2000s',
    brand: '达亿瓦',
    name: '月影 MX 2000S',
    category: 'reel',
    spec: { model: '2000S', ratio: '5.2:1' },
  },
  {
    id: 'cat-reel-shimano-nasci-2500s',
    brand: '禧玛诺',
    name: 'NASCI 2500S',
    category: 'reel',
    spec: { model: '2500S', ratio: '5.0:1' },
  },
  {
    id: 'cat-reel-shimano-stradic-sw-4000xg',
    brand: '禧玛诺',
    name: 'STRADIC SW 4000XG',
    category: 'reel',
    spec: { model: '4000XG', ratio: '6.2:1' },
  },

  // 拟饵
  {
    id: 'cat-lure-duo-minnow-95f',
    brand: 'DUO',
    name: '浮水米诺 95F',
    category: 'lure',
    spec: { lureType: '浮水米诺', weight: '11g' },
  },
  {
    id: 'cat-lure-duo-minnow-85s',
    brand: 'DUO',
    name: '沉水米诺 85S',
    category: 'lure',
    spec: { lureType: '沉水米诺', weight: '14g' },
  },
  {
    id: 'cat-lure-sm-popper-65',
    brand: '诗蜜',
    name: '波爬 65 铅笔',
    category: 'lure',
    spec: { lureType: '波爬', weight: '8g' },
  },
  {
    id: 'cat-lure-bee-spinner-7g',
    brand: '小蜜蜂',
    name: '旋转亮片 7g',
    category: 'lure',
    spec: { lureType: '旋转亮片', weight: '7g' },
  },
]
