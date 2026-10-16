/**
 * 天气数据的形状。
 *
 * 只放「真实拿得到」的字段：拿不到的写 null，界面上显示「—」，
 * 绝不为了填满卡片编一个数字。
 */

/** 天气现象的粗分类，给推荐规则用（比逐条匹配 WMO 代码稳定得多） */
export type WeatherKind =
  | 'clear'
  | 'cloudy'
  | 'overcast'
  | 'rain'
  | 'snow'
  | 'fog'
  | 'thunder'

export interface WeatherNow {
  /** 数据来源，界面上要署名 */
  source: string
  /** 数据来源的主页 */
  sourceUrl: string
  /** 观测时间的地点本地时刻，例「14:20」；拿不到就是 null */
  observedLabel: string | null
  /** 观测时间对应的本地日期，例「2026-10-17」；拿不到就是 null */
  observedDate: string | null
  /** 天气现象文字，例「多云」 */
  condition: string
  /** 现象代码（WMO），给规则用 */
  conditionCode: number | null
  kind: WeatherKind
  /** 气温（℃） */
  temperatureC: number
  /** 体感温度（℃） */
  apparentC: number | null
  /** 相对湿度（%） */
  humidityPercent: number | null
  /** 最近一小时降水量（mm） */
  precipitationMm: number | null
  /** 风向文字，例「东北」；静风时为 null */
  windDirection: string | null
  /** 蒲福风级 0–12 */
  windPower: number | null
  /** 风速（km/h） */
  windSpeedKmh: number | null
  /** 白天 / 夜间，拿不到就是 null */
  isDay: boolean | null
  /** 当地日出时刻，例「05:52」 */
  sunriseLabel: string | null
  /** 当地日落时刻，例「17:34」 */
  sunsetLabel: string | null
  /** 这份数据是**什么时候取到的**（本机时间戳），用来判断新旧 */
  fetchedAt: number
}

export interface WeatherRequest {
  latitude: number
  longitude: number
}

/** 取天气失败时带一句能给用户看的话 */
export class WeatherError extends Error {
  /** true = 网络层面就没通（断网、超时） */
  readonly offline: boolean

  constructor(message: string, offline = false) {
    super(message)
    this.name = 'WeatherError'
    this.offline = offline
  }
}
