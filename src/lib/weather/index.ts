/**
 * 天气服务的入口：带缓存、去重、失败不吞。
 *
 * 三条纪律：
 * 1. **同一个位置的短时间内只请求一次**：内存缓存 10 分钟，同一位置的并发请求合并成一个。
 * 2. **换页不白屏**：上次取到的天气会存一份在 localStorage，刷新或断网时先把它显示出来，
 *    并明确标出「更新于几点几分」——是旧数据就说旧数据，不冒充实时。
 * 3. **失败要能重试**：失败不进缓存，下次调用会真的重新请求。
 */
import { fetchOpenMeteoWeather } from './openMeteo'
import type { WeatherNow, WeatherRequest } from './types'

export * from './types'
export {
  describeWeatherCode,
  describeWindDirection,
  describeWindPower,
  fetchOpenMeteoWeather,
} from './openMeteo'

/** 内存缓存有效期：10 分钟内回到首页不会重复请求 */
const MEMORY_TTL_MS = 10 * 60_000
/** 跨刷新的缓存最多留 3 小时，再旧就不显示了（宁可显示「暂无数据」） */
const STORE_MAX_AGE_MS = 3 * 60 * 60_000
/** 缓存粒度：经纬度保留 2 位小数，约 1 公里内算同一个地方 */
const CACHE_DIGITS = 2
const STORE_KEY = 'luremate:weather:v1'
const CACHE_LIMIT = 8

interface CacheEntry {
  at: number
  data: WeatherNow
}

const memory = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<WeatherNow>>()

export function weatherKeyOf(point: WeatherRequest): string {
  return `${point.latitude.toFixed(CACHE_DIGITS)},${point.longitude.toFixed(CACHE_DIGITS)}`
}

/* --------------------------- 跨刷新的那一份缓存 --------------------------- */

interface StoredWeather {
  key: string
  at: number
  data: WeatherNow
}

/** 把 JSON 读回来的东西验一遍再当数据用：坏数据宁可当没有 */
function readStored(): StoredWeather | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  const data =
    typeof record.data === 'object' && record.data !== null
      ? (record.data as Record<string, unknown>)
      : null
  if (!data) return null
  if (typeof data.temperatureC !== 'number' || typeof data.condition !== 'string') return null

  const at = typeof record.at === 'number' ? record.at : 0
  const key = typeof record.key === 'string' ? record.key : ''
  if (!key || !at) return null
  if (Date.now() - at > STORE_MAX_AGE_MS) return null

  return { key, at, data: data as unknown as WeatherNow }
}

function writeStored(key: string, data: WeatherNow): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ key, at: Date.now(), data }))
  } catch {
    // 存不进去（隐私模式、空间满了）就算了：内存里那份还在，只是刷新后要重新请求
  }
}

/* ------------------------------- 对外接口 ------------------------------- */

export interface CachedWeather {
  data: WeatherNow
  /** true = 这份数据已经超过内存缓存的有效期（仍可显示，但要标明时间） */
  stale: boolean
}

/**
 * 同步拿缓存：先看内存，再看上次存在本机的。拿不到返回 null。
 *
 * 用来在请求发出之前就把卡片画出来，避免整块区域先空一下再突然出现。
 */
export function readCachedWeather(point: WeatherRequest): CachedWeather | null {
  const key = weatherKeyOf(point)

  const hit = memory.get(key)
  if (hit) return { data: hit.data, stale: Date.now() - hit.at > MEMORY_TTL_MS }

  const stored = readStored()
  if (stored && stored.key === key) {
    // 顺手放回内存，省得这段时间里每渲染一次都要读一遍 localStorage
    memory.set(key, { at: stored.at, data: stored.data })
    return { data: stored.data, stale: true }
  }

  return null
}

/**
 * 取这个位置的当前天气。
 *
 * - 命中内存缓存且没过期：直接返回，不发请求
 * - 同一位置已有请求在飞：跟着那一个，不重复发
 * - `force`：用户手动点「刷新」时用，绕过缓存
 */
export function loadWeather(
  point: WeatherRequest,
  options: { force?: boolean } = {},
): Promise<WeatherNow> {
  const key = weatherKeyOf(point)
  const hit = memory.get(key)

  if (!options.force && hit && Date.now() - hit.at < MEMORY_TTL_MS) {
    return Promise.resolve(hit.data)
  }

  const pending = inflight.get(key)
  if (pending && !options.force) return pending

  const task = fetchOpenMeteoWeather(point)
    .then((data) => {
      memory.set(key, { at: Date.now(), data })
      // 缓存条目太多就丢掉最早的一个（Map 保持插入顺序）
      while (memory.size > CACHE_LIMIT) {
        const oldest = memory.keys().next()
        if (oldest.done) break
        memory.delete(oldest.value)
      }
      writeStored(key, data)
      return data
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, task)
  return task
}
