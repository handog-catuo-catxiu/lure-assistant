/**
 * 中国大陆手机号的规范化、校验与展示。
 *
 * CloudBase 的 v3 手机号验证码接口最终会自己补 `+86`；
 * 这里统一只保留 11 位数字，界面和本地状态都不保存国家区号。
 */

const CHINA_MOBILE_PATTERN = /^1[3-9]\d{9}$/

/** 去掉空格、横线、括号和 +86 / 0086 前缀，返回纯数字号码。 */
export function normalizeChinaPhone(input: string): string {
  const digits = input.replace(/\D/g, '')

  if (digits.startsWith('0086')) return digits.slice(4)
  if (digits.startsWith('86') && digits.length > 11) return digits.slice(2)
  return digits
}

/** 是否为合法的 11 位中国大陆手机号（1 开头，第二位 3–9）。 */
export function isValidChinaPhone(input: string): boolean {
  return CHINA_MOBILE_PATTERN.test(normalizeChinaPhone(input))
}

/** 登录后只展示脱敏手机号，例如 13800138000 → 138****8000。 */
export function maskPhone(input: string): string {
  const phone = normalizeChinaPhone(input)
  if (!CHINA_MOBILE_PATTERN.test(phone)) return '已登录账号'
  return `${phone.slice(0, 3)}****${phone.slice(7)}`
}
