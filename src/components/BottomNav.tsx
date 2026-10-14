import type { Ref } from 'react'
import { BoxIcon, FishIcon, PinIcon, UserIcon } from './icons'
import './BottomNav.css'

export type TabKey = 'gear' | 'spot' | 'catch' | 'mine'

interface TabItem {
  key: TabKey
  label: string
  Icon: (props: { size?: number }) => React.ReactElement
}

const TABS: TabItem[] = [
  { key: 'gear', label: '装备', Icon: BoxIcon },
  { key: 'spot', label: '钓点', Icon: PinIcon },
  { key: 'catch', label: '渔获', Icon: FishIcon },
  { key: 'mine', label: '我的', Icon: UserIcon },
]

interface BottomNavProps {
  active: TabKey
  onChange: (tab: TabKey) => void
  /** 页面向下滚动时整条滑出屏幕，由 useDockVisibility 决定 */
  hidden: boolean
  /** 交给 useDockVisibility 量真实高度，用来给滚动容器留出等高空白 */
  navRef?: Ref<HTMLElement>
}

export default function BottomNav({ active, onChange, hidden, navRef }: BottomNavProps) {
  return (
    <nav
      ref={navRef}
      className={`bottom-nav${hidden ? ' bottom-nav--hidden' : ''}`}
      aria-label="主导航"
    >
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`bottom-nav__item${active === key ? ' bottom-nav__item--active' : ''}`}
          onClick={() => onChange(key)}
          aria-current={active === key ? 'page' : undefined}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
