import type { ReactNode } from 'react'
import { ArrowLeftIcon } from './icons'
import './TopBar.css'

interface TopBarProps {
  title: string
  subtitle?: string
  onBack: () => void
  /** 返回按钮的可访问名称，例如「返回出勤列表」 */
  backLabel?: string
  /** 右侧自定义内容 */
  action?: ReactNode
}

/**
 * 流程页（开始出勤、正在出勤、出勤详情）顶部的返回栏。
 * 吸顶显示，滚动时始终能点到返回。
 */
export default function TopBar({
  title,
  subtitle,
  onBack,
  backLabel = '返回',
  action,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <button
        type="button"
        className="top-bar__back"
        onClick={onBack}
        aria-label={backLabel}
      >
        <ArrowLeftIcon size={20} />
      </button>

      <div className="top-bar__text">
        <h1 className="top-bar__title">{title}</h1>
        {subtitle && <p className="top-bar__subtitle">{subtitle}</p>}
      </div>

      {action && <div className="top-bar__action">{action}</div>}
    </header>
  )
}
