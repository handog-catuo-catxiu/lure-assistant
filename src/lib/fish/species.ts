/**
 * 鱼种资料表：推荐规则的**数据**，规则本身在 recommend.ts。
 *
 * 每一行的字段都是「可判断的属性」，不是「哪个城市推哪条鱼」的硬编码：
 *
 * - `latBand`：分布纬度带（用绝对值，南北半球通用）。这是地区判断的主依据 ——
 *   同一个纬度带里的水域，条件本来就相似，比按国家 / 城市列举更站得住脚。
 * - `water`：出没的水域类型。海水鱼只在判定为近海时才推荐。
 * - `tempRange`：活跃气温区间（拿气温近似水温）。
 * - `seasons` / `peak`：活跃季节与最活跃的季节（按半球换算后的季节）。
 * - `likes` / `dislikes`：对天气现象的偏好。
 *
 * 新增鱼种只要在这里加一行，推荐逻辑一个字都不用改。
 */
import type { WeatherKind } from '../weather/types'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type WaterType = 'still' | 'flowing' | 'sea' | 'unknown'
export type Hemisphere = 'n' | 's'

export interface SpeciesProfile {
  id: string
  name: string
  /** 活跃气温区间（℃），[最低, 最高] */
  tempRange: [number, number]
  seasons: Season[]
  /** 最活跃的季节（可以理解为「这两个月最值得专门去钓它」） */
  peak: Season[]
  /** 出没水域；sea 表示只认近海 */
  water: Exclude<WaterType, 'unknown'>[]
  /** 分布纬度带（绝对值）。超出这个范围就不推荐 */
  latBand: [number, number]
  /** 只有单一半球有分布时写明；不写表示两个半球都有 */
  hemispheres?: Hemisphere[]
  likes?: WeatherKind[]
  dislikes?: WeatherKind[]
  /** 偏好的风力条件；不写表示不敏感 */
  wind?: 'calm' | 'windy'
  /** 一天里最值得下竿的时段 */
  activeTime: 'lowLight' | 'day' | 'night' | 'allDay'
  /** 一句话操作建议 */
  tip: string
  /** 为什么它会出现在这张表里的补充说明，写给看代码的人 */
  rangeNote: string
}

export const SPECIES: SpeciesProfile[] = [
  {
    id: 'culter',
    name: '翘嘴鲌',
    tempRange: [12, 30],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['summer', 'autumn'],
    water: ['still', 'flowing'],
    latBand: [20, 46],
    hemispheres: ['n'],
    likes: ['cloudy', 'rain'],
    wind: 'windy',
    activeTime: 'lowLight',
    tip: '盯水面炸水的位置，用米诺或波扒快速抽停，风浪天反而更出鱼。',
    rangeNote: '东亚平原的江河湖库，大水面种群最稳定',
  },
  {
    id: 'mandarin',
    name: '鳜鱼',
    tempRange: [15, 30],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['autumn'],
    water: ['still', 'flowing'],
    latBand: [20, 42],
    hemispheres: ['n'],
    dislikes: ['clear'],
    activeTime: 'lowLight',
    tip: '贴着石头、倒树这些结构跳底，软虫比硬饵更稳。',
    rangeNote: '中国长江及以南水系，喜欢有结构的底质',
  },
  {
    id: 'snakehead',
    name: '黑鱼',
    tempRange: [16, 33],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['summer'],
    water: ['still'],
    latBand: [18, 42],
    hemispheres: ['n'],
    likes: ['clear'],
    activeTime: 'day',
    tip: '找水草缝和浮萍边，雷蛙慢慢走，中鱼后一口气拉离草区。',
    rangeNote: '东亚的池塘、河湾静水，离不开水草',
  },
  {
    id: 'largemouth',
    name: '大口黑鲈',
    tempRange: [14, 30],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['spring', 'autumn'],
    water: ['still'],
    latBand: [20, 50],
    likes: ['cloudy', 'overcast'],
    activeTime: 'lowLight',
    tip: '沿库湾、倒树缓沉搜索，阴天可以放心用亮色饵。',
    rangeNote: '温带淡水广泛引种，欧美与东亚的湖库都有',
  },
  {
    id: 'catfish',
    name: '鲶鱼',
    tempRange: [18, 33],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['summer'],
    water: ['still', 'flowing'],
    latBand: [0, 55],
    likes: ['rain', 'overcast'],
    activeTime: 'night',
    tip: '天黑之后钓浅滩和入水口，用带味道的软饵。',
    rangeNote: '温带至热带的淡水底层，全球都有近亲',
  },
  {
    id: 'yellowcheek',
    name: '鳡鱼',
    tempRange: [18, 31],
    seasons: ['summer', 'autumn'],
    peak: ['summer'],
    water: ['still', 'flowing'],
    latBand: [22, 38],
    hemispheres: ['n'],
    wind: 'windy',
    activeTime: 'lowLight',
    tip: '大水面追炸水群，用大号亮片长距离抛投，装备强度要够。',
    rangeNote: '中国长江流域的大型水面',
  },
  {
    id: 'chinese-hooksnout',
    name: '马口鱼',
    tempRange: [10, 27],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['spring', 'summer'],
    water: ['flowing'],
    latBand: [20, 42],
    hemispheres: ['n'],
    likes: ['clear'],
    activeTime: 'day',
    tip: '溪流里逆流抛小亮片，人躲在石头后面别惊到水花。',
    rangeNote: '中国东部山溪与清水支流',
  },
  {
    id: 'spiny-barb',
    name: '军鱼（光倒刺鲃）',
    tempRange: [16, 31],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['summer'],
    water: ['flowing'],
    latBand: [18, 32],
    hemispheres: ['n'],
    activeTime: 'day',
    tip: '急流回水湾是首选，小胖丁或软虫贴底推。',
    rangeNote: '华南溪流与河谷',
  },
  {
    id: 'rainbow-trout',
    name: '虹鳟',
    tempRange: [5, 21],
    seasons: ['spring', 'autumn', 'winter'],
    peak: ['spring', 'autumn'],
    water: ['flowing', 'still'],
    latBand: [25, 65],
    likes: ['cloudy', 'overcast'],
    wind: 'calm',
    activeTime: 'lowLight',
    tip: '冷水溪流的深潭与落水线附近顺流抛，亮片和小型米诺都行。',
    rangeNote: '温带冷水，南北半球的高纬度与高海拔水域都有',
  },
  {
    id: 'brown-trout',
    name: '褐鳟',
    tempRange: [7, 20],
    seasons: ['spring', 'autumn', 'winter'],
    peak: ['autumn'],
    water: ['flowing'],
    latBand: [35, 68],
    dislikes: ['clear'],
    activeTime: 'lowLight',
    tip: '阴天、浑水时它才敢出来，飞蝇与小型亮片都好用。',
    rangeNote: '欧洲、北美与新西兰的冷水溪流',
  },
  {
    id: 'northern-pike',
    name: '北方狗鱼',
    tempRange: [4, 21],
    seasons: ['spring', 'autumn', 'winter'],
    peak: ['spring', 'autumn'],
    water: ['still', 'flowing'],
    latBand: [40, 70],
    hemispheres: ['n'],
    likes: ['overcast'],
    activeTime: 'day',
    tip: '水草边缘用大号亮片或软虫，记得加钢丝前导。',
    rangeNote: '北半球高纬度湖库与缓流',
  },
  {
    id: 'perch',
    name: '河鲈（五道黑）',
    tempRange: [8, 23],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['autumn'],
    water: ['still', 'flowing'],
    latBand: [40, 66],
    hemispheres: ['n'],
    activeTime: 'day',
    tip: '成群活动，找到一群就能连竿，小软虫配铅头钩最省事。',
    rangeNote: '欧亚大陆北部的湖库与河道',
  },
  {
    id: 'seabass',
    name: '海鲈',
    tempRange: [10, 26],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['autumn'],
    water: ['sea'],
    latBand: [30, 60],
    hemispheres: ['n'],
    wind: 'windy',
    activeTime: 'lowLight',
    tip: '涨落潮交界的那一小时最集中，用长身米诺顺流搜。',
    rangeNote: '东北大西洋与地中海沿岸、河口咸淡水',
  },
  {
    id: 'striped-bass',
    name: '条纹鲈',
    tempRange: [10, 25],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['autumn'],
    water: ['sea'],
    latBand: [25, 48],
    hemispheres: ['n'],
    likes: ['cloudy'],
    activeTime: 'lowLight',
    tip: '追潮汐与饵鱼群，用铅笔饵打表层炸水。',
    rangeNote: '北美东海岸与河口',
  },
  {
    id: 'kingfish',
    name: '黄尾鰤',
    tempRange: [14, 27],
    seasons: ['spring', 'summer', 'autumn'],
    peak: ['autumn'],
    water: ['sea'],
    latBand: [20, 45],
    wind: 'windy',
    activeTime: 'lowLight',
    tip: '礁石与岬角外侧的流带，铁板快抽，注意礁石磨线。',
    rangeNote: '温带近岸，南北半球都有分布',
  },
]

export const SEASON_LABELS: Record<Season, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
}

export const WATER_LABELS: Record<WaterType, string> = {
  still: '湖库静水',
  flowing: '江河溪流',
  sea: '近海',
  unknown: '不确定',
}
