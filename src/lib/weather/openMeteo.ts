/**
 * 天气数据来源：Open-Meteo（https://open-meteo.com）。
 *
 * ## 为什么不是高德天气
 *
 * 高德的天气接口（`/v3/weather/weatherInfo`）属于**Web 服务**平台的能力，
 * 已有的那把「Web 端（JS API）」Key 调它会直接返回 `USERKEY_PLAT_NOMATCH`
 * （已实测：同一把 Key 调 `/v3/place/text` 正常，调天气接口就被拒）。
 * 要用它就得再申请一把 Web 服务 Key，而且这把 Key 必须由服务端注入 ——
 * 现有的高德代理只补 `jscode`，为天气另开一条代理链路就又动到了
 * 「不许改高德安全代理」那条线。所以天气走 Open-Meteo：
 *
 *   - **不需要任何 Key**：没有密钥要藏，也就没有泄露风险
 *   - **全球覆盖**：用户不在中国、在南半球都能用（鱼种推荐必须支持这些情况）
 *   - **坐标就是 WGS84**：和 App 里存的坐标同一套，**不需要任何坐标转换**，
 *     也就不会出现重复转换导致的偏移
 *   - 气温、湿度、降水、风向、风速、天气现象、日出日落、观测时间都有
 *
 * 地图和定位仍然全部走高德，这里只负责天气这一件事。
 *
 * ## 只信真实读数
 *
 * 解析时每个字段都单独校验，缺哪个就返回 null，界面上写「—」，
 * 不会用 0 或者「晴」把卡片填满。
 */
import { WeatherError, type WeatherKind, type WeatherNow, type WeatherRequest } from './types'

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const SOURCE = 'Open-Meteo'
const SOURCE_URL = 'https://open-meteo.com/'

/** 单次请求超时（ms）。卡住不返回比失败更难受，超时就当没网处理 */
const TIMEOUT_MS = 12_000

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
].join(',')

/* ------------------------------ WMO 天气代码 ------------------------------ */

interface CodeInfo {
  label: string
  kind: WeatherKind
}

/**
 * WMO 天气现象代码 → 中文 + 粗分类。
 * 表里没有的代码返回 null，调用方会说「天气现象暂缺」，不猜。
 */
const WMO_CODES: Record<number, CodeInfo> = {
  0: { label: '晴', kind: 'clear' },
  1: { label: '晴间多云', kind: 'cloudy' },
  2: { label: '多云', kind: 'cloudy' },
  3: { label: '阴', kind: 'overcast' },
  45: { label: '有雾', kind: 'fog' },
  48: { label: '雾凇', kind: 'fog' },
  51: { label: '小毛毛雨', kind: 'rain' },
  53: { label: '毛毛雨', kind: 'rain' },
  55: { label: '大毛毛雨', kind: 'rain' },
  56: { label: '冻毛毛雨', kind: 'rain' },
  57: { label: '强冻毛毛雨', kind: 'rain' },
  61: { label: '小雨', kind: 'rain' },
  63: { label: '中雨', kind: 'rain' },
  65: { label: '大雨', kind: 'rain' },
  66: { label: '冻雨', kind: 'rain' },
  67: { label: '强冻雨', kind: 'rain' },
  71: { label: '小雪', kind: 'snow' },
  73: { label: '中雪', kind: 'snow' },
  75: { label: '大雪', kind: 'snow' },
  77: { label: '雪粒', kind: 'snow' },
  80: { label: '小阵雨', kind: 'rain' },
  81: { label: '阵雨', kind: 'rain' },
  82: { label: '强阵雨', kind: 'rain' },
  85: { label: '小阵雪', kind: 'snow' },
  86: { label: '大阵雪', kind: 'snow' },
  95: { label: '雷阵雨', kind: 'thunder' },
  96: { label: '雷阵雨伴冰雹', kind: 'thunder' },
  99: { label: '强雷阵雨伴冰雹', kind: 'thunder' },
}

export function describeWeatherCode(code: number | null): CodeInfo | null {
  if (code === null) return null
  return WMO_CODES[code] ?? null
}

/* --------------------------------- 小工具 --------------------------------- */

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

/** 风向角度 → 八个方位。静风不编方向，返回 null */
export function describeWindDirection(degrees: number | null): string | null {
  if (degrees === null) return null
  const normalized = ((degrees % 360) + 360) % 360
  return DIRECTIONS[Math.round(normalized / 45) % 8]
}

/**
 * 风速（km/h）→ 蒲福风级。
 * 分界值取常用的 km/h 版本，界面上显示成「3 级」。
 */
const BEAUFORT_MAX_KMH = [1, 5, 11, 19, 28, 38, 49, 61, 74, 88, 102, 117]

export function describeWindPower(kmh: number | null): number | null {
  if (kmh === null) return null
  for (let level = 0; level < BEAUFORT_MAX_KMH.length; level++) {
    if (kmh < BEAUFORT_MAX_KMH[level]) return level
  }
  return 12
}

/** ISO 本地时间「2026-10-17T05:52」→ { date: '2026-10-17', label: '05:52' } */
function splitLocalTime(value: unknown): { date: string; label: string } | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
  if (!match) return null
  return { date: match[1], label: match[2] }
}

/* --------------------------------- 请求 --------------------------------- */

function buildUrl(point: WeatherRequest): string {
  const url = new URL(ENDPOINT)
  // 小数位多一点没意义：模型格点本来就比这粗
  url.searchParams.set('latitude', point.latitude.toFixed(4))
  url.searchParams.set('longitude', point.longitude.toFixed(4))
  url.searchParams.set('current', CURRENT_FIELDS)
  url.searchParams.set('daily', 'sunrise,sunset')
  url.searchParams.set('forecast_days', '1')
  // 让返回的时间是**当地**时间，界面上「更新于 14:20」才不用用户自己换算
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('wind_speed_unit', 'kmh')
  return url.toString()
}

/**
 * 取一次当前天气。**传入的必须是 WGS84 坐标**（和 App 里存坐标同一套），
 * 这里不做任何坐标转换。
 */
export async function fetchOpenMeteoWeather(
  point: WeatherRequest,
  signal?: AbortSignal,
): Promise<WeatherNow> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // 外部传进来的取消信号也要能打断这次请求（例如页面已经切走了）
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch(buildUrl(point), {
      signal: controller.signal,
      // 天气接口不带任何身份信息，也不需要 Cookie
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch (error) {
    if (signal?.aborted) throw new WeatherError('天气请求已取消。', true)
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    throw new WeatherError(
      aborted
        ? '天气服务响应超时了，检查一下网络再试。'
        : '连不上天气服务，可能是当前网络受限。',
      true,
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    throw new WeatherError(`天气服务返回了 ${response.status}，稍后再试。`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new WeatherError('天气数据读不出来（返回的不是有效数据）。')
  }

  const root =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : {}
  const current =
    typeof root.current === 'object' && root.current !== null
      ? (root.current as Record<string, unknown>)
      : {}

  const temperature = num(current.temperature_2m)
  if (temperature === null) {
    throw new WeatherError('天气服务这次没返回气温，稍后再试。')
  }

  const code = num(current.weather_code)
  const info = describeWeatherCode(code)
  const observed = splitLocalTime(current.time)

  const daily =
    typeof root.daily === 'object' && root.daily !== null
      ? (root.daily as Record<string, unknown>)
      : {}
  const sunrise = splitLocalTime(Array.isArray(daily.sunrise) ? daily.sunrise[0] : null)
  const sunset = splitLocalTime(Array.isArray(daily.sunset) ? daily.sunset[0] : null)

  const speed = num(current.wind_speed_10m)
  const direction = describeWindDirection(num(current.wind_direction_10m))
  const isDayRaw = num(current.is_day)

  return {
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    observedLabel: observed?.label ?? null,
    observedDate: observed?.date ?? null,
    // 表里没有的代码就说「暂缺」，不硬套一个「晴」
    condition: info?.label ?? '天气现象暂缺',
    conditionCode: code,
    kind: info?.kind ?? 'cloudy',
    temperatureC: temperature,
    apparentC: num(current.apparent_temperature),
    humidityPercent: num(current.relative_humidity_2m),
    precipitationMm: num(current.precipitation),
    // 无风时 Open-Meteo 会给风速 0，这时方向没有意义
    windDirection: speed !== null && speed > 0 ? direction : null,
    windPower: describeWindPower(speed),
    windSpeedKmh: speed,
    isDay: isDayRaw === null ? null : isDayRaw >= 0.5,
    sunriseLabel: sunrise?.label ?? null,
    sunsetLabel: sunset?.label ?? null,
    fetchedAt: Date.now(),
  }
}
