/** 记录「上一次操作时间」的引用，用 useRef(0) 初始化即可 */
export interface TapGuardRef {
  current: number
}

/**
 * 连点保护：距离上次放行不足 cooldownMs 就拒绝这一次。
 *
 * 放在组件外面是因为时间戳属于「渲染之外的状态」——
 * 在组件里直接读 Date.now() 会破坏渲染的纯粹性（react-hooks/purity）。
 * 注意它拦的只是手抖连点，正常的两条记录之间间隔远大于这个值。
 */
export function passTapGuard(guard: TapGuardRef, cooldownMs: number): boolean {
  const now = Date.now()
  if (now - guard.current < cooldownMs) return false
  guard.current = now
  return true
}
