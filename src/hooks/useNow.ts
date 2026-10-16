import { useEffect, useState } from 'react'

/**
 * 当前时间戳，每隔 intervalMs 更新一次。
 *
 * 用来判断「手上这条定位读数是不是已经旧了」：组件里不能直接读时钟
 * （react-hooks/purity 不允许在渲染过程中取当前时间），交给这个 hook 定时喂。
 * 默认 10 秒一次就够——定位新鲜度的门槛是分钟级的，不需要每秒重渲染。
 */
export function useNow(intervalMs = 10_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return

    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    // 后台标签页的定时器会被降频，回到前台时立刻对齐一次
    const sync = () => setNow(Date.now())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [intervalMs, enabled])

  return now
}
