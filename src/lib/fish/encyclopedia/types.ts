/**
 * 鱼类百科的数据结构。
 *
 * 这一层是**资料**，不是规则也不是 AI 输出：
 * 内容写死在仓库里，打开页面就读本地数据，不联网、不调用 AI 重新生成。
 * 推荐卡片只带 speciesId，点进去按 id 取这里的条目 —— 两边不会各说各话。
 *
 * 每条资料都要求写清「资料来源」。没有可靠来源的内容宁可不写，
 * 也不编一段听起来很像那么回事的介绍。
 */
import type { Season, WaterType } from '../species'

export type LureDifficulty = '入门' | '进阶' | '较高'

export interface SizeRange {
  /** 常见体长（cm），[下限, 上限] */
  lengthCm: [number, number]
  /** 常见体重（kg），[下限, 上限] */
  weightKg: [number, number]
  /** 补充说明：极限个体、雌雄差异之类，只写有依据的 */
  note?: string
}

export interface LureSetup {
  /** 常用拟饵 */
  lures: string[]
  /** 操作手法 */
  retrieve: string
  /** 建议装备（竿轮线） */
  gear: string
  /** 钓位选择 */
  spots: string
}

export interface SpeciesSource {
  /** 来源名称，例如「FishBase」 */
  label: string
  /** 说明这条资料具体参考了它的哪一部分 */
  detail?: string
}

export interface SpeciesEntry {
  /** 与推荐规则表 SPECIES 里的 id 一致，推荐卡片靠它跳转 */
  id: string
  name: string
  /** 学名（拉丁名），带命名人时写在 scientificNameFull */
  scientificName: string
  scientificNameFull?: string
  /** 别名 / 地方名 */
  aliases: string[]
  /**
   * 图片路径（放在 public/species/ 下）。没有图就留空 ——
   * 界面会显示占位图并写明「暂无图片」，不拿别的鱼的照片冒充。
   */
  image?: string
  /** 图片作者 / 授权说明，用了别人的图必须写 */
  imageCredit?: string

  /** 外形特征 */
  appearance: string
  /** 生活习性 */
  habits: string
  /** 食性 */
  diet: string
  /** 常见体长与重量 */
  size: SizeRange
  /** 在中国大陆的分布 */
  distribution: string
  /** 分布所属的水域类型，用于和推荐规则交叉检查 */
  water: WaterType[]
  /** 四季活动特点 */
  seasons: Record<Season, string>
  /** 路亚玩法 */
  luring: LureSetup
  /** 路亚难度 */
  difficulty: LureDifficulty
  /** 注意事项（安全、法规、放流等） */
  cautions: string[]
  /** 资料来源 */
  sources: SpeciesSource[]
  /** 保护级别或渔业法规提醒；没有明确依据就不写 */
  legalNote?: string
  /** 资料最后核对时间（YYYY-MM） */
  reviewedAt: string
}
