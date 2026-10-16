/** 出勤与渔获的时间、时长、尺寸的展示格式 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 例：2026-10-16 */
export function formatDate(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 例：10月16日 周四 */
export function formatDateCN(ts: number): string {
  const date = new Date(ts)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`
}

/** 例：14:32 */
export function formatClock(ts: number): string {
  const date = new Date(ts)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 例：14:32:05，上鱼时间精确到秒 */
export function formatClockSec(ts: number): string {
  const date = new Date(ts)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export interface DurationParts {
  hours: number
  minutes: number
  seconds: number
}

/** 把毫秒拆成时 / 分 / 秒，负数按 0 处理 */
export function splitDuration(ms: number): DurationParts {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

/** 计时器上的 时:分:秒，例：01:23:45 */
export function formatTimer(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms)
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

/** 时长文案，例：2 小时 05 分 / 23 分 45 秒 / 40 秒 */
export function formatDuration(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms)
  if (hours > 0) return `${hours} 小时 ${pad2(minutes)} 分`
  if (minutes > 0) return `${minutes} 分 ${pad2(seconds)} 秒`
  return `${seconds} 秒`
}

/** 长度文案，例：32 cm / 32.5 cm */
export function formatLength(cm: number): string {
  return `${Number.isInteger(cm) ? cm : cm.toFixed(1)} cm`
}

/** 重量文案，例：850 g / 1.25 kg */
export function formatWeight(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`
  return `${Number.isInteger(g) ? g : g.toFixed(1)} g`
}
