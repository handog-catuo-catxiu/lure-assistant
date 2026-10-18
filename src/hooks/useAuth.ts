import { useCallback, useEffect, useState } from 'react'
import type { SignInRes } from '@cloudbase/js-sdk/auth'
import { getAuth } from '../lib/cloudbase'
import { AuthFlowError, authErrorMessage } from '../lib/authError'
import { authUserFromSession, type AuthUser } from '../lib/authUser'
import { normalizeChinaPhone } from '../lib/phone'

export type { AuthUser } from '../lib/authUser'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

/**
 * signInWithOtp 返回的一次性校验凭据。
 * CloudBase 要求把发送验证码后拿到的 verifyOtp 回调保存下来，
 * 再调用 verifyOtp({ token }) 完成登录；不能重新发一次请求或单独调用 auth.verifyOtp。
 */
export interface AuthChallenge {
  verifyOtp: (params: { token: string }) => Promise<SignInRes>
}

export interface AuthApi {
  status: AuthStatus
  user: AuthUser | null
  /** 恢复会话失败时的非阻塞提示；不影响本地数据与其他功能 */
  notice: string | null
  sendCode: (phone: string) => Promise<AuthChallenge>
  signIn: (phone: string, code: string, challenge: AuthChallenge) => Promise<void>
  signOut: () => Promise<void>
}

/**
 * 账号状态。只做登录/注册第一阶段：不读写云数据库，也不碰本地装备。
 *
 * 刷新后能否保持登录由 SDK 的 persistence: 'local' 负责；
 * 这里在挂载时用 getSession() 恢复，data.session 为空即未登录。
 */
export function useAuth(): AuthApi {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function restore() {
      try {
        const auth = await getAuth()
        const result = await auth.getSession()
        if (result.error) throw result.error

        const restored = authUserFromSession(result.data?.session?.user)
        if (cancelled) return

        if (restored) {
          setUser(restored)
          setStatus('signedIn')
        } else {
          setUser(null)
          setStatus('signedOut')
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('signedOut')
          setNotice(authErrorMessage(error))
        }
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  const sendCode = useCallback(async (phone: string): Promise<AuthChallenge> => {
    const auth = await getAuth()
    // 11 位号码交给 SDK；SDK 会自行补 +86。未注册的手机号会在这条链路上自动创建账号。
    const result = await auth.signInWithOtp({
      phone: normalizeChinaPhone(phone),
    })
    if (result.error) throw result.error

    const verifyOtp = result.data?.verifyOtp
    if (typeof verifyOtp !== 'function') {
      throw new AuthFlowError('验证码已发送，但没有拿到校验凭据，请重新获取')
    }

    return {
      verifyOtp: (params: { token: string }) => verifyOtp({ token: params.token }),
    }
  }, [])

  const signIn = useCallback(
    async (phone: string, code: string, challenge: AuthChallenge) => {
      const result = await challenge.verifyOtp({ token: code.trim() })
      if (result.error) throw result.error

      let signedInUser = authUserFromSession(
        result.data?.session?.user ?? result.data?.user,
        phone,
      )

      // 正常情况下 verifyOtp 已经写入会话；这里再兜底读一次，
      // 保证拿到的 uid 来自 CloudBase 会话，而不是手机号。
      if (!signedInUser) {
        const auth = await getAuth()
        const session = await auth.getSession()
        if (session.error) throw session.error
        signedInUser = authUserFromSession(session.data?.session?.user, phone)
      }

      if (!signedInUser) {
        throw new AuthFlowError('登录没有完成，请重新获取验证码后重试')
      }

      setUser(signedInUser)
      setStatus('signedIn')
      setNotice(null)
    },
    [],
  )

  const signOut = useCallback(async () => {
    const auth = await getAuth()
    const result = await auth.signOut()
    if (result?.error) throw result.error

    setUser(null)
    setStatus('signedOut')
    setNotice(null)
  }, [])

  return { status, user, notice, sendCode, signIn, signOut }
}
