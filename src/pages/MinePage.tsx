import { useState } from 'react'
import LoginModal from '../components/LoginModal'
import PageHeader from '../components/PageHeader'
import {
  ChevronRightIcon,
  ClockIcon,
  FishIcon,
  LayersIcon,
  UserIcon,
} from '../components/icons'
import { ALL_SPECIES } from '../lib/fish/encyclopedia'
import { type AuthApi } from '../hooks/useAuth'
import { authErrorMessage } from '../lib/authError'
import { maskPhone } from '../lib/phone'
import type { TripApi } from '../hooks/useTrip'
import './MinePage.css'

/**
 * 我的。
 *
 * 渔获档案、出勤记录和鱼类百科都从这里进 —— 底部 Dock 的中间是「出勤」按钮，
 * 所以历史出勤的入口放在这里，功能一个都没少。
 */

interface MinePageProps {
  trip: TripApi
  auth: AuthApi
  onOpenCatches: () => void
  onOpenTrips: () => void
  onOpenSpeciesList: () => void
}

export default function MinePage({
  trip,
  auth,
  onOpenCatches,
  onOpenTrips,
  onOpenSpeciesList,
}: MinePageProps) {
  const catchCount = trip.catches.length
  const tripCount = trip.sessions.length
  const [loginOpen, setLoginOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  const signedIn = auth.status === 'signedIn'

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError(null)
    try {
      await auth.signOut()
    } catch (error) {
      setSignOutError(authErrorMessage(error))
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="mine">
      <PageHeader title="我的" subtitle="账号登录与本机记录" />

      <section className="mine-account" aria-label="账号">
        <span className="mine-account__icon" aria-hidden="true">
          <UserIcon size={22} />
        </span>
        <span className="mine-account__text">
          <span className="mine-account__title">
            {auth.status === 'loading'
              ? '正在检查登录状态…'
              : signedIn
                ? maskPhone(auth.user?.phone ?? '')
                : '登录 / 注册'}
          </span>
          <span className="mine-account__sub">
            {auth.status === 'loading'
              ? '本机记录不受影响'
              : signedIn
                ? '已登录 · 刷新页面后仍保持登录'
                : '手机号验证码登录，未注册会自动创建账号'}
          </span>
        </span>
        {signedIn ? (
          <button
            type="button"
            className="mine-account__action"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            {signingOut ? '退出中…' : '退出登录'}
          </button>
        ) : auth.status === 'signedOut' ? (
          <button
            type="button"
            className="mine-account__action mine-account__action--primary"
            onClick={() => setLoginOpen(true)}
          >
            登录
          </button>
        ) : null}
      </section>

      {(auth.notice || signOutError) && (
        <p className="mine-account__error" role="alert">
          {signOutError ?? auth.notice}
        </p>
      )}

      <nav className="mine-list" aria-label="我的记录">
        <button type="button" className="mine-entry" onClick={onOpenCatches}>
          <span className="mine-entry__icon mine-entry__icon--warm" aria-hidden="true">
            <FishIcon size={20} />
          </span>
          <span className="mine-entry__text">
            <span className="mine-entry__title">我的渔获</span>
            <span className="mine-entry__sub">记录每一次精彩上鱼</span>
          </span>
          {/* 真实累计条数：一条都没有就是 0 条，不编数字 */}
          <span className="mine-entry__count">{catchCount} 条</span>
          <ChevronRightIcon size={18} />
        </button>

        <button type="button" className="mine-entry" onClick={onOpenTrips}>
          <span className="mine-entry__icon" aria-hidden="true">
            <ClockIcon size={20} />
          </span>
          <span className="mine-entry__text">
            <span className="mine-entry__title">出勤记录</span>
            <span className="mine-entry__sub">每一场出勤的轨迹与渔获</span>
          </span>
          <span className="mine-entry__count">{tripCount} 场</span>
          <ChevronRightIcon size={18} />
        </button>

        <button type="button" className="mine-entry" onClick={onOpenSpeciesList}>
          <span className="mine-entry__icon" aria-hidden="true">
            <LayersIcon size={20} />
          </span>
          <span className="mine-entry__text">
            <span className="mine-entry__title">鱼类百科</span>
            <span className="mine-entry__sub">形态、分布、四季习性与路亚玩法</span>
          </span>
          <span className="mine-entry__count">{ALL_SPECIES.length} 种</span>
          <ChevronRightIcon size={18} />
        </button>
      </nav>

      <section className="mine-note">
        <h2 className="mine-note__title">关于数据</h2>
        <p>
          出勤、渔获、钓点、装备和照片都保存在这台设备上（浏览器本地存储与 IndexedDB），
          不会上传到任何服务器。
        </p>
        <p>
          登录只用于识别账号，目前不会同步这些记录；清理浏览器数据仍会一并清掉它们。
        </p>
        <p>重要的渔获建议另外留存照片。</p>
      </section>

      {loginOpen && (
        <LoginModal auth={auth} onClose={() => setLoginOpen(false)} />
      )}
    </div>
  )
}
