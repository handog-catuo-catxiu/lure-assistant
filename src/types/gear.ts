/** 装备分类：鱼竿 / 渔轮 / 拟饵 / 周边装备 */
export type GearCategory = 'rod' | 'reel' | 'lure' | 'accessory'

/**
 * 规格字段键。不同分类使用不同字段：
 * - 鱼竿：length / action
 * - 渔轮：model / ratio
 * - 拟饵：lureType / weight
 * - 周边装备：accessoryType
 *
 * 这些字段都是可选的（GearSpec 是 Partial），旧数据没有 accessoryType 也照常读取，
 * 所以新增分类不需要动 localStorage 里的任何一条已有记录。
 */
export type SpecKey =
  | 'length'
  | 'action'
  | 'model'
  | 'ratio'
  | 'lureType'
  | 'weight'
  | 'accessoryType'

/** 分类专属规格，只需填写当前分类用到的字段 */
export type GearSpec = Partial<Record<SpecKey, string>>

/** 单件装备 */
export interface GearItem {
  id: string
  name: string
  category: GearCategory
  /** 品牌 */
  brand: string
  /** 分类专属规格 */
  spec: GearSpec
  /** 使用备注 */
  note: string
  /** 入手日期，格式 YYYY-MM-DD */
  purchasedAt: string
  /** 是否常用装备 */
  favorite: boolean
  /** 从装备图鉴选择时记录的产品 id，用于取图鉴图片 */
  catalogId?: string
  /**
   * 首页列表左侧是否显示装备图片（默认 false，显示品牌 Logo）。
   * V0.4 之前的旧数据没有这个字段，读取时按 false 处理。
   */
  showImageOnHome: boolean
}

/** 新增/编辑时提交的数据（id 由数据层生成） */
export type GearDraft = Omit<GearItem, 'id'>

/** 分类展示配置 */
export interface CategoryMeta {
  label: string
  /** 数量单位，例如「支」「个」「枚」 */
  unit: string
  desc: string
}

export const CATEGORY_META: Record<GearCategory, CategoryMeta> = {
  rod: { label: '鱼竿', unit: '支', desc: '直柄 / 枪柄' },
  reel: { label: '渔轮', unit: '个', desc: '纺车 / 水滴轮' },
  lure: { label: '拟饵', unit: '枚', desc: '米诺 / 亮片 / 软虫' },
  accessory: { label: '周边装备', unit: '件', desc: '包 / 钳 / 抄网' },
}

/**
 * 分类顺序。新增分类往这里加一项即可：首页分类卡片、筛选条、数量统计都从这里派生，
 * 类型层（Record<GearCategory, …>）也会在漏掉某一项时报错。
 */
export const CATEGORY_ORDER: GearCategory[] = ['rod', 'reel', 'lure', 'accessory']

/**
 * 周边装备的「周边类型」。第一批内置这 8 项，以后要加就往数组里追加，
 * 表单的选择框和详情页会跟着自动更新。
 */
export const ACCESSORY_TYPES = [
  '路亚包',
  '渔夫帽',
  '路亚钳',
  '抄网',
  '饵盒',
  '路亚手套',
  '偏光眼镜',
  '其他周边',
] as const

/** 规格输入项配置，表单按分类渲染对应字段 */
export interface SpecField {
  key: SpecKey
  label: string
  placeholder: string
  /**
   * 有固定选项的字段：表单渲染成选择框（select）而不是文本框，
   * 也就不会出现在底部那个两列的「规格」输入区里。
   */
  options?: readonly string[]
}

/**
 * 周边装备的类型字段。表单里渲染成选择框，位置紧跟在「装备分类」下方
 * （所以它不在下面的两列规格区里出现），但数据存在 spec.accessoryType 上，
 * 因此详情页、列表摘要、搜索都能像其它分类的规格一样自动带上它。
 */
const ACCESSORY_FIELD: SpecField = {
  key: 'accessoryType',
  label: '周边类型',
  placeholder: '例如 路亚包',
  options: ACCESSORY_TYPES,
}

export const SPEC_FIELDS: Record<GearCategory, SpecField[]> = {
  rod: [
    { key: 'length', label: '长度', placeholder: '例如 2.1m' },
    { key: 'action', label: '调性', placeholder: '例如 ML调' },
  ],
  reel: [
    { key: 'model', label: '型号', placeholder: '例如 2500S' },
    { key: 'ratio', label: '速比', placeholder: '例如 5.2:1' },
  ],
  lure: [
    { key: 'lureType', label: '类型', placeholder: '例如 浮水米诺' },
    { key: 'weight', label: '重量', placeholder: '例如 11g' },
  ],
  accessory: [ACCESSORY_FIELD],
}

/** 有固定选项、需要渲染成选择框的规格字段 */
export function isSelectField(field: SpecField): boolean {
  return Array.isArray(field.options) && field.options.length > 0
}

/** 周边类型字段（表单在分类下方单独渲染它） */
export const ACCESSORY_TYPE_FIELD = ACCESSORY_FIELD

/** 把分类规格拼成一行展示文案 */
export function formatSpec(category: GearCategory, spec: GearSpec): string {
  return SPEC_FIELDS[category]
    .map((field) => spec[field.key]?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' / ')
}

/** 本地时区的今天，格式 YYYY-MM-DD */
export function todayISO(): string {
  const now = new Date()
  const offsetMs = now.getTimezoneOffset() * 60 * 1000
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10)
}
