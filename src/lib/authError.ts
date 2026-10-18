import type { AuthErrorCategory } from '@cloudbase/js-sdk/auth'

/** 本应用主动抛出的、已经可以直接展示给用户的错误。 */
export class AuthFlowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthFlowError'
  }
}

/**
 * 把 CloudBase / 网络 / 短信通道的错误翻译成界面文案。
 * 不展示后端原始 message，避免把内部错误码和请求信息带到用户面前。
 */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthFlowError) return error.message

  const rawMessage = error instanceof Error ? error.message : ''
  if (isSmsQuotaError(rawMessage)) return SMS_QUOTA_MESSAGE

  const category = getCategory(error)

  switch (category) {
    case 'INVALID_PARAMS':
      return '手机号格式不正确，请检查后重试'
    case 'VERIFICATION_FAILED':
    case 'INVALID_CREDENTIALS':
      return '验证码不正确或已过期，请重新获取'
    case 'RATE_LIMITED':
      return rateLimitMessage(error)
    case 'CAPTCHA_REQUIRED':
    case 'CAPTCHA_INVALID':
      return '请求太频繁，请稍后再试'
    case 'PROVIDER_NOT_ENABLED':
      return '短信验证码登录尚未在 CloudBase 控制台开启'
    case 'USER_STATUS_ABNORMAL':
      return '这个账号当前不可用，请联系管理员'
    case 'SERVICE_ERROR':
      return '短信服务暂时不可用，请稍后重试'
    case 'PRECONDITION_FAILED':
      return '当前无法发送短信，请稍后重试'
    case 'MFA_REQUIRED':
    case 'AUTH_METHOD_MISMATCH':
    case 'USER_NOT_FOUND':
    case 'UNKNOWN':
      return '操作没有完成，请稍后重试'
  }

  // 只把真正的网络类错误当成断网；其他 TypeError 是代码问题，
  // 不能笼统地显示成“网络连接失败”，否则会把真实故障藏起来。
  if (/network|fetch|load failed|timeout|ERR_NETWORK/i.test(rawMessage)) {
    return NETWORK_MESSAGE
  }
  return '操作没有完成，请稍后重试'
}

const NETWORK_MESSAGE =
  '网络连接失败，请检查网络；若仍失败，请确认当前域名已加入 CloudBase 安全域名'
const SMS_QUOTA_MESSAGE =
  '短信发送额度不足，暂时无法获取验证码，请检查 CloudBase 短信额度后再试'

function getCategory(error: unknown): AuthErrorCategory | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const category = (error as { category?: unknown }).category
  return typeof category === 'string' ? (category as AuthErrorCategory) : undefined
}

/**
 * CloudBase 没有单独的“短信额度不足”错误分类，
 * RESOURCE_EXHAUSTED 会被归到 RATE_LIMITED，所以这里同时看原始文案。
 */
function isSmsQuotaError(message: string): boolean {
  return /额度|配额|资源包|欠费|余额不足|套餐.*(用尽|超|不足)|quota|insufficient\s+(balance|quota)|out\s+of\s+quota/i.test(
    message,
  )
}

function rateLimitMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const retryAfter = (error as { retryAfter?: unknown }).retryAfter
    if (typeof retryAfter === 'number' && retryAfter > 0 && retryAfter <= 600) {
      return `请求太频繁，请 ${Math.ceil(retryAfter)} 秒后再试`
    }
  }
  return '请求太频繁，请稍后再试'
}
