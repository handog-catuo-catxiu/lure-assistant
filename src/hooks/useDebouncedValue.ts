import { useEffect, useState } from 'react'

/**
 * 防抖：值停下不动 delayMs 之后才跟着变。
 *
 * 用在地图选点上：手指在屏幕上连点几下时，不该每一下都去请求一次地名，
 * 等用户停稳了再查这一次就够了（高德的调用次数也是有限的）。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
