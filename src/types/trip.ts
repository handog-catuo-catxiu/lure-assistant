/**
 * LureMate「路亚出勤系统」的数据类型。
 *
 * 三份数据彼此独立，各自有稳定的唯一 id：
 * - 标点 Spot：可以重复使用的地点，一个标点会被很多场出勤引用
 * - 出勤 TripSession：一次出勤，只用 id 引用标点和装备，不复制它们的内容
 * - 渔获 CatchRecord：一条鱼，属于某一场出勤
 *
 * 时间统一用毫秒时间戳（number）。装备的文字数据仍在 localStorage，
 * 照片仍在 IndexedDB，渔获照片按 catchId 存放在独立的图片仓库里，
 * GPS 轨迹点按 sessionId 存放在 trackPoints 仓库里。
 *
 * GPS 相关的字段**全部可选**：老数据没有它们照常显示，
 * 拿不到定位时也不会写入任何猜测出来的坐标。
 */

/** 一次定位读数：经纬度 + 精度 + 采集时间 */
export interface GeoPoint {
  latitude: number
  longitude: number
  /** 定位精度（米），越大越不准 */
  accuracy: number
  /** 这次读数的采集时间 */
  recordedAt: number
}

/**
 * 这条定位是怎么来的。
 * - `device`：高德定位插件拿到的设备定位（系统 GPS / WiFi 定位），可以入库
 * - `ip`：高德拿不到设备定位时退回的 IP 粗略定位，误差可能几公里，
 *   只能在地图上当个参考，**不能**写进标点、渔获或轨迹
 */
export type LocationSource = 'device' | 'ip'

/**
 * 带来源的定位读数。界面上要说清「这是设备定位还是 IP 大致位置」，
 * 入库前也要据此把 IP 结果挡掉，所以来源跟着读数一起传。
 */
export interface LiveGeoPoint extends GeoPoint {
  source: LocationSource
}

/** 标点：可重复使用的地点 */
export interface Spot {
  id: string
  name: string
  note: string
  createdAt: number
  updatedAt: number
  /** 标点位置。用户没有记录位置时为 undefined，不影响其它功能 */
  latitude?: number
  longitude?: number
  /**
   * 定位解析出来的地名，例如「千岛湖」「××水库」。
   * 只用来展示和提示，不参与任何计算；用户可以随便改 name，这个字段留着当出处。
   */
  placeName?: string
}

/** 新建 / 编辑标点提交的内容；不带位置时保留标点原有位置 */
export interface SpotDraft {
  name: string
  note: string
  latitude?: number
  longitude?: number
  placeName?: string
}

/** 出勤状态：进行中 / 已结束 */
export type TripStatus = 'active' | 'completed'

/**
 * 数据来源。网页版固定写 'web'；
 * 未来 iOS / Apple Watch 版本写入各自的标识，便于区分记录从哪来。
 */
export type TripSource = 'web' | 'ios' | 'watch'

/**
 * 一场出勤。
 *
 * gearIds 是「出勤装备」——这次带出去的装备，只存 id。
 * 渔获里实际用到的装备（渔获装备）记在 CatchRecord 上，两者不是一回事。
 */
export interface TripSession {
  id: string
  spotId: string
  /**
   * 开始出勤那一刻的标点名快照。
   * 标点之后被删除时，历史记录仍然能显示当时去的是哪儿。
   */
  spotName: string
  gearIds: string[]
  startedAt: number
  /** 进行中为 null */
  endedAt: number | null
  status: TripStatus
  createdAt: number
  updatedAt: number
  source?: TripSource
  /** 预留给未来的计步与抛投次数识别，本期不写入 */
  steps?: number
  castCount?: number
}

/**
 * 一条渔获。
 * 点「一键上鱼」时先落库的就是这些字段：id、sessionId、spotId、caughtAt。
 * 鱼种、照片、长度、重量、装备都是之后补充的选填内容。
 */
export interface CatchRecord {
  id: string
  sessionId: string
  /** 上鱼时所在出勤的标点 */
  spotId: string
  /** 上鱼时间，精确到秒 */
  caughtAt: number
  createdAt: number
  updatedAt: number
  species: string
  lengthCm: number | null
  weightG: number | null
  /** 实际使用的装备（渔获装备），没选为 null */
  rodId: string | null
  reelId: string | null
  lureId: string | null
  note: string
  /**
   * 上鱼时的位置。只有在点「一键上鱼」那一刻存在足够新鲜、
   * 精度合格的真实定位时才会写入；没有定位就留空，
   * 绝不拿标点坐标冒充实际上鱼位置。
   */
  latitude?: number
  longitude?: number
  /** 这次位置读数的采集时间（不是上鱼时间） */
  locationRecordedAt?: number
  /** 这次位置读数的精度（米） */
  locationAccuracy?: number
}

/** 补充 / 编辑渔获时提交的内容 */
export interface CatchDraft {
  species: string
  lengthCm: number | null
  weightG: number | null
  rodId: string | null
  reelId: string | null
  lureId: string | null
  note: string
  /**
   * 位置改动。undefined = 保持原样；null = 清除位置；
   * 传 GeoPoint = 写入这次定位读数。
   */
  location?: GeoPoint | null
}

/** 补充 / 编辑渔获时提交的内容 */
export interface CatchSavePayload {
  draft: CatchDraft
  /** 照片改动：新选的图片，或删除已有照片 */
  photo: { file?: File; remove?: boolean }
  /** 用户主动勾选「加入本次出勤装备」时要并进去的装备 id */
  addGearIds: string[]
}

/** 能在渔获里指定的三类装备（周边装备不参与上鱼） */
export const CATCH_GEAR_CATEGORIES = ['rod', 'reel', 'lure'] as const

export type CatchGearCategory = (typeof CATCH_GEAR_CATEGORIES)[number]

/** 渔获里每个分类对应的字段名 */
export const CATCH_GEAR_FIELD: Record<
  CatchGearCategory,
  'rodId' | 'reelId' | 'lureId'
> = {
  rod: 'rodId',
  reel: 'reelId',
  lure: 'lureId',
}

/** 长度 / 重量的合理上限，用于输入校验 */
export const MAX_LENGTH_CM = 300
export const MAX_WEIGHT_G = 100_000

/**
 * 一个 GPS 轨迹点，属于某一场出勤。
 *
 * 轨迹点数量大（一场出勤几百到几千个），存在 IndexedDB 的 trackPoints
 * 仓库里，按 sessionId 建索引，不写 localStorage。
 * 每个点都是真实采到的读数，中断期间不会补点。
 */
export interface TrackPoint {
  id: string
  sessionId: string
  latitude: number
  longitude: number
  /** 采集时间 */
  recordedAt: number
  /** 定位精度（米）；旧数据可能没有 */
  accuracy: number | null
}

/** 业务操作的结果：要么成功带值，要么带着可以直接显示给用户的原因失败 */
export type TripResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; error: string }
