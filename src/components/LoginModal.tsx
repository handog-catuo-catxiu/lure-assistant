import { useEffect, useRef, useState, type FormEvent } from 'react'
import Modal from './Modal'
import type { AuthApi, AuthChallenge } from '../hooks/useAuth'
import { authErrorMessage } from '../lib/authError'
import { isValidChinaPhone, maskPhone, normalizeChinaPhone } from '../lib/phone'
import './LoginModal.css'

interface LoginModalProps {
  auth: AuthApi
  onClose: () => void
}

const RESEND_SECONDS = 60

/**
 * 中国大陆手机号 + 短信验证码登录 / 注册。
 *
 * 一次流程同时覆盖两种结果：CloudBase 根据手机号是否已注册，
 * 在 signInWithOtp 内部决定登录还是创建账号。
 */
export default function LoginModal({ auth, onClose }: LoginModalProps) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<AuthChallenge | null>(null)
  const [sentTo, setSentTo] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function handlePhoneChange(value: string) {
    const normalized = normalizeChinaPhone(value).slice(0, 11)
    setPhone(normalized)
    setError(null)

    // 换了手机号，上一份验证码凭据就不能再用了，同时允许立即重新发送。
    if (sentTo && normalized !== sentTo) {
      setChallenge(null)
      setSentTo('')
      setCode('')
      setCooldown(0)
    }
  }

  async function handleSendCode() {
    const target = normalizeChinaPhone(phone)
    if (!isValidChinaPhone(target)) {
      setError('请输入正确的 11 位中国大陆手机号')
      return
    }

    setSending(true)
    setError(null)
    try {
      const nextChallenge = await auth.sendCode(target)
      setChallenge(nextChallenge)
      setSentTo(target)
      setCode('')
      setCooldown(RESEND_SECONDS)
      // 等按钮状态渲染完再聚焦，手机端会自动弹出数字键盘
      window.setTimeout(() => codeRef.current?.focus(), 0)
    } catch (sendError) {
      setError(authErrorMessage(sendError))
    } finally {
      setSending(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    if (!challenge) {
      setError('请先获取短信验证码')
      return
    }
    if (!code.trim()) {
      setError('请输入短信中的验证码')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      // 用收到验证码的那个号码登录，避免输入框后来被改动
      await auth.signIn(sentTo, code, challenge)
      onClose()
    } catch (submitError) {
      setError(authErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="登录 / 注册"
      subtitle="用中国大陆手机号验证码登录，未注册会自动创建账号"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            form="login-form"
            className="btn btn--primary"
            disabled={sending || submitting || !code.trim()}
          >
            {submitting ? '登录中…' : '登录 / 注册'}
          </button>
        </>
      }
    >
      <form id="login-form" className="login-form" onSubmit={handleSubmit} noValidate>
        <div className="login-field">
          <label className="login-label" htmlFor="login-phone">
            手机号
          </label>
          <div className="login-code-row">
            <div className="login-phone-wrap">
              <span className="login-phone-prefix" aria-hidden="true">
                +86
              </span>
              <input
                id="login-phone"
                className="login-input login-phone-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={20}
                placeholder="请输入 11 位手机号"
                value={phone}
                onChange={(event) => handlePhoneChange(event.target.value)}
                disabled={sending || submitting}
              />
            </div>
            <button
              type="button"
              className="login-send"
              onClick={() => void handleSendCode()}
              disabled={sending || cooldown > 0 || submitting}
            >
              {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s` : '获取验证码'}
            </button>
          </div>
        </div>

        <div className="login-field">
          <label className="login-label" htmlFor="login-code">
            验证码
          </label>
          <input
            id="login-code"
            ref={codeRef}
            className="login-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder={sentTo ? '请输入短信验证码' : '请先获取验证码'}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\s+/g, '').slice(0, 8))
              setError(null)
            }}
            disabled={sending || submitting}
          />
        </div>

        {sentTo && (
          <p className="login-hint" aria-live="polite">
            验证码已发送至 {maskPhone(sentTo)}。未注册的手机号验证通过后会自动创建账号。
          </p>
        )}

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <p className="login-hint">
          登录只用于识别账号。本机的出勤、装备、钓点和照片仍然只保存在这台设备上，
          不会因为登录而上传。
        </p>
      </form>
    </Modal>
  )
}
