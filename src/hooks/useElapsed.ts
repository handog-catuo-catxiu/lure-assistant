import { useEffect, useState } from 'react'

/**
 * 从 startedAt 到现在经过的毫秒数（startedAt 为 null 时返回 0）。
 *
 * 每秒重新算一次，但取值永远来自 `Date.now() - startedAt`，
 * 不是把定时器触发次数累加起来：锁屏、切到别的 App、刷新网页之后回来，
 * 显示的仍然是真实经过的时间。
 *
 * 后台标签页的定时器会被浏览器降频甚至暂停，所以回到前台时再补算一次。
 */
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null) return

    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const sync = () => setNow(Date.now())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [startedAt])

  if (startedAt === null) return 0
  return Math.max(0, now - startedAt)
}
