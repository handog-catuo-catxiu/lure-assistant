import type { ReactNode } from 'react'
import './PageHeader.css'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** 标题右侧的补充信息 */
  extra?: ReactNode
  /** 标题下方的自定义内容，例如统计块 */
  children?: ReactNode
}

/**
 * 标签页顶部的渐变标题区，视觉沿用装备页 Header（同一套渐变与圆角），
 * 让几个底部导航页看起来是一套东西。
 */
export default function PageHeader({
  title,
  subtitle,
  extra,
  children,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__top">
        <div className="page-header__text">
          <h1 className="page-header__title">{title}</h1>
          {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
        </div>
        {extra && <div className="page-header__extra">{extra}</div>}
      </div>

      {children}
    </header>
  )
}
