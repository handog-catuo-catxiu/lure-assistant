/**
 * 本地数据的「归属范围」。
 *
 * 三种范围，彼此完全隔离：
 * - ''（空字符串）：还没有归属账号的本机旧数据，键名保持原样（luremate:gear:v1 等）
 * - 'guest'：本机数据已经被某个账号认领过，退出登录后不再展示那份数据
 * - 'u:<uid>'：某个账号自己的本机镜像，键名统一加前缀
 *
 * 账号隔离只认 CloudBase 的 uid，不用手机号。切换范围时 localStorage 键和
 * IndexedDB 数据库名都会跟着变，所以账号 B 看不到账号 A 的记录和照片。
 */
import { createId } from '../ids'

const LEGACY_SCOPE = ''
const GUEST_SCOPE = 'guest'
const CLAIM_KEY = 'luremate:migration:v1'
const DEVICE_KEY = 'luremate:device-id:v1'

let scope = LEGACY_SCOPE
const listeners = new Set<(next: string) => void>()

export function accountScope(uid: string): string {
  return `u:${uid}`
}

/** 当前页面正在使用哪一份本地数据 */
export function activeScope(): string {
  return scope
}

export function isAccountScope(): boolean {
  return scope.startsWith('u:')
}

export function activeUid(): string | null {
  return isAccountScope() ? scope.slice(2) : null
}

/** 由 uid + 登录状态决定应该使用哪个范围 */
export function resolveScope(uid: string | null): string {
  if (uid) return accountScope(uid)
  // 本机数据已被认领过时，退出登录不再把旧数据展示出来，
  // 避免下一个人在这台设备上直接看到上一个账号的私人记录。
  return readClaim() ? GUEST_SCOPE : LEGACY_SCOPE
}

/**
 * 切换数据范围。必须在数据 hook（useGear / useTrip / 图片库）渲染之前调用。
 * 返回是否真的发生了变化，方便调用方决定是否重新挂载组件。
 */
export function activateScope(next: string): boolean {
  if (next === scope) return false
  scope = next
  for (const listener of listeners) listener(next)
  return true
}

export function onScopeChange(listener: (next: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 把基础键名映射到当前范围。
 * 账号范围下 `luremate:gear:v1` → `luremate:u:<uid>:gear:v1`。
 */
export function scopedKey(base: string): string {
  return keyForScope(base, scope)
}

export function keyForScope(base: string, targetScope: string): string {
  if (!targetScope) return base
  const name = base.startsWith('luremate:') ? base.slice('luremate:'.length) : base
  return `luremate:${targetScope}:${name}`
}

/** 未登录时是否还有一份没有被任何账号认领的本机数据 */
export function isLegacyScope(): boolean {
  return scope === LEGACY_SCOPE
}

export function isGuestScope(): boolean {
  return scope === GUEST_SCOPE
}

/* --------------------------- IndexedDB 数据库名 --------------------------- */

/**
 * 每个范围一个独立数据库。旧的 luremate 数据库原样保留，
 * 新范围用新库，升级代码不会碰到老库里的照片和轨迹。
 */
export function databaseNameForScope(targetScope: string): string {
  if (!targetScope) return 'luremate'
  return `luremate-${targetScope.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

/* ------------------------------ 设备标识 ------------------------------ */

/** 只用于判断「同一份改动是不是这台设备发出的」，不是用户身份 */
export function getDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY)
    if (saved) return saved
    const next = createId('dev')
    localStorage.setItem(DEVICE_KEY, next)
    return next
  } catch {
    return 'dev-unknown'
  }
}

/* ------------------------------ 认领标记 ------------------------------ */

export interface ClaimMarker {
  uid: string
  claimedAt: number
  counts: Record<string, number>
}

/** 本机旧数据是否已经被某个账号认领过 */
export function readClaim(): ClaimMarker | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value = parsed as Record<string, unknown>
    if (typeof value.uid !== 'string' || !value.uid) return null
    return {
      uid: value.uid,
      claimedAt:
        typeof value.claimedAt === 'number' && Number.isFinite(value.claimedAt)
          ? value.claimedAt
          : 0,
      counts:
        typeof value.counts === 'object' && value.counts !== null
          ? (value.counts as Record<string, number>)
          : {},
    }
  } catch {
    return null
  }
}

export function writeClaim(uid: string, counts: Record<string, number>): void {
  try {
    localStorage.setItem(
      CLAIM_KEY,
      JSON.stringify({ uid, claimedAt: Date.now(), counts } satisfies ClaimMarker),
    )
  } catch {
    // 标记写不进去时本次导入仍然有效；下次会重新检测并提示
  }
}

/** 当前账号是否就是认领这份本机数据的账号 */
export function claimedByCurrentUid(): boolean {
  const uid = activeUid()
  if (!uid) return false
  return readClaim()?.uid === uid
}

/** 本机旧数据是否可以被当前账号认领（没被别的账号认领过） */
export function canClaimLegacy(): boolean {
  const uid = activeUid()
  if (!uid) return false
  const claim = readClaim()
  return claim === null || claim.uid === uid
}

export const LEGACY_SCOPE_NAME = LEGACY_SCOPE
export const GUEST_SCOPE_NAME = GUEST_SCOPE
