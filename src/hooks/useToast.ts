import { useCallback, useEffect, useRef, useState } from 'react'

/** 轻提示：显示一段时间后自动消失 */
export function useToast(duration = 1800) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const showToast = useCallback(
    (text: string) => {
      setMessage(text)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMessage(null), duration)
    },
    [duration],
  )

  return { message, showToast }
}
