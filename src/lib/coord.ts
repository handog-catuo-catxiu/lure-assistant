/**
 * 坐标系：WGS84（原始 GPS） ⇄ GCJ-02（高德地图）。
 *
 * ## 为什么要单独一个文件
 *
 * 定位拿到的是 **WGS84**（国际标准，GPS 原始值）；高德地图的底图、标记，
 * 以及高德的地理编码 / POI 服务用的都是 **GCJ-02**（国测局坐标，俗称火星坐标）。
 * 两者在国内相差几十米到几百米，直接混用会导致轨迹、标点、上鱼位置整体偏移。
 *
 * ## 本项目的约定（务必遵守）
 *
 * - **存进 localStorage / IndexedDB 的一律是 WGS84**（除非显式标了 coordSystem）。
 *   历史数据也都是 WGS84：它们来自定位读数，从来没有写入过任何地图坐标，
 *   所以不需要、也不允许批量改写。
 * - 高德定位服务有时会直接给出 GCJ-02（IP 定位、转换成功的设备定位），
 *   那种情况在 `lib/amap/geolocation.ts` 里用 `fromMapLngLat()` 转回 WGS84
 *   再交给上层；判断依据是插件的结果字段，不能靠猜。
 * - **只有画到高德地图上、或送去高德服务查询时，才临时转成 GCJ-02**，
 *   转换发生在渲染/调用的那一刻，算完即用，绝不回写数据。
 * - 「原始 GPS 坐标」和「地图展示坐标」在代码里用不同名字区分：
 *   存储/计算用 `StoredCoordinate`，上地图一律经过 `toMapLngLat()`。
 *
 * 转换用的是公开的 WGS84→GCJ-02 算法（与各家开源实现一致），
 * 不调用任何联网接口，因此可以在轨迹回放的每一帧里安全使用，也不会被限流。
 */
import { hasCoordinates } from './geo'

/** 记录里保存的坐标系。不写时视为 'wgs84'（历史数据全是浏览器 GPS 采的） */
export type CoordSystem = 'wgs84' | 'gcj02'

/** 默认坐标系：原始 GPS */
export const DEFAULT_COORD_SYSTEM: CoordSystem = 'wgs84'

/**
 * 一个位置，只要求经纬度。
 * 地图上的临时点（正在选、还没保存）用它就够了，
 * 不需要为了凑 GeoPoint 编造精度和采集时间。
 */
export interface Coordinate {
  latitude: number
  longitude: number
}

/** 任何带经纬度的东西都可以用这个形状描述 */
export interface StoredCoordinate extends Coordinate {
  /** 缺省 = WGS84。目前库里存的全是 WGS84，转换只在展示时发生 */
  coordSystem?: CoordSystem
}

/** 把数据库/表单里读到的值收敛成合法的坐标系标记 */
export function normalizeCoordSystem(value: unknown): CoordSystem {
  return value === 'gcj02' ? 'gcj02' : DEFAULT_COORD_SYSTEM
}

/* ---------------------------- 算法参数 ---------------------------- */

/** 克拉索夫斯基椭球长半轴 */
const A = 6378245.0
/**
 * 椭球偏心率平方。
 * 官方文档写的是 0.00669342162296594323，但双精度存不下那么多位，
 * 这里直接写成它实际舍入到的那个值，免得读代码的人以为多出来的位有效。
 */
const EE = 0.006693421622965943
const PI = Math.PI

/**
 * 中国大陆粗略范围（不含港澳台与境外）。
 * 范围外 GCJ-02 与 WGS84 完全一致，直接原样返回，避免「转出国外」。
 */
export function isInChina(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  return (
    longitude >= 73.66 &&
    longitude <= 135.05 &&
    latitude >= 3.86 &&
    latitude <= 53.55
  )
}

function transformLat(x: number, y: number): number {
  let ret =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3
  return ret
}

function transformLng(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3
  return ret
}

/** WGS84 → GCJ-02（上高德地图之前必须做的一步） */
export function wgs84ToGcj02(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } {
  if (!isInChina(latitude, longitude)) return { latitude, longitude }

  let dLat = transformLat(longitude - 105, latitude - 35)
  let dLng = transformLng(longitude - 105, latitude - 35)

  const radLat = (latitude / 180) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)

  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI)

  return { latitude: latitude + dLat, longitude: longitude + dLng }
}

/**
 * GCJ-02 → WGS84。
 *
 * 正变换没有解析反函数，这里用迭代逼近：拿 WGS84 反复正变换，
 * 把残差补回去，三次之后误差在厘米级（远小于 GPS 本身的米级误差）。
 */
export function gcj02ToWgs84(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } {
  if (!isInChina(latitude, longitude)) return { latitude, longitude }

  let wgsLat = latitude
  let wgsLng = longitude

  for (let i = 0; i < 3; i += 1) {
    const guess = wgs84ToGcj02(wgsLat, wgsLng)
    wgsLat += latitude - guess.latitude
    wgsLng += longitude - guess.longitude
  }

  return { latitude: wgsLat, longitude: wgsLng }
}

/* ------------------------- 上地图 / 下地图 ------------------------- */

/**
 * 把**存下来的**坐标转成高德地图用的 `[经度, 纬度]`（GCJ-02）。
 * 所有往高德地图上画的东西都必须走这里，不许自己拼数组。
 */
export function toMapLngLat(point: StoredCoordinate): [number, number] {
  if (!hasCoordinates(point)) return [Number.NaN, Number.NaN]

  if (normalizeCoordSystem(point.coordSystem) === 'gcj02') {
    // 本来就是高德坐标，原样使用 —— 绝不重复转换
    return [point.longitude, point.latitude]
  }

  const converted = wgs84ToGcj02(point.latitude, point.longitude)
  return [converted.longitude, converted.latitude]
}

/**
 * 高德地图上取下来的点（点击选点、POI、搜索结果）转成入库用的 WGS84。
 * 这样「地图选点」和「GPS 定位」存下来的坐标是同一套坐标系，
 * 之后算距离、画轨迹都不会因为混用两套坐标而偏移。
 */
export function fromMapLngLat(
  lng: number,
  lat: number,
): { latitude: number; longitude: number } {
  return gcj02ToWgs84(lat, lng)
}
