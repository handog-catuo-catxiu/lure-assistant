import { normalizeChinaPhone } from './phone'

/** 登录后的账号信息。uid 是 CloudBase 的真实用户 ID，phone 只用于展示。 */
export interface AuthUser {
  uid: string
  phone: string
}

/** SDK Session.user 里本应用会用到的字段，保持最小依赖。 */
export interface SessionUserLike {
  id?: unknown
  sub?: unknown
  uid?: unknown
  phone?: unknown
  is_anonymous?: unknown
}

/**
 * 从 CloudBase 会话用户里取出账号信息。
 *
 * - 身份只认 id；sub / uid 仅作兼容兜底。
 * - 匿名登录不算真实登录。
 * - 手机号只是展示信息，绝不能拿来代替 uid。
 */
export function authUserFromSession(
  user: SessionUserLike | null | undefined,
  fallbackPhone = '',
): AuthUser | null {
  if (!user || user.is_anonymous === true) return null

  const uid =
    [user.id, user.sub, user.uid]
      .map((value) => (value === null || value === undefined ? '' : String(value).trim()))
      .find(Boolean) ?? ''
  if (!uid) return null

  const phone = normalizeChinaPhone(
    typeof user.phone === 'string' ? user.phone : fallbackPhone,
  )
  return { uid, phone }
}
