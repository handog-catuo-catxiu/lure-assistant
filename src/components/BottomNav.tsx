import type { ReactElement, RefObject } from 'react'
import { BoxIcon, HomeIcon, PinIcon, RodIcon, UserIcon } from './icons'
import './BottomNav.css'

/**
 * 底部导航。
 *
 * 一共五个位置：首页｜装备｜**出勤**｜钓点｜我的。
 * 中间那个不是普通标签页，而是「出勤」这个动作本身：
 * 没在出勤时点它进「开始出勤」流程，正在出勤时点它回到正在出勤的页面。
 * 出勤记录（历史列表）放在「我的」里，所以中间的按钮不需要承担列表入口。
 */
export type TabKey = 'home' | 'gear' | 'spot' | 'trip' | 'mine'

interface TabItem {
  key: Exclude<TabKey, 'trip'>
  label: string
  Icon: (props: { size?: number }) => ReactElement
}

/** 左侧两个 + 右侧两个，中间留给出勤按钮 */
const LEFT_TABS: TabItem[] = [
  { key: 'home', label: '首页', Icon: HomeIcon },
  { key: 'gear', label: '装备', Icon: BoxIcon },
]

const RIGHT_TABS: TabItem[] = [
  { key: 'spot', label: '钓点', Icon: PinIcon },
  { key: 'mine', label: '我的', Icon: UserIcon },
]

interface BottomNavProps {
  /** 当前标签页；出勤流程里（非标签页）传什么都不会高亮出错 */
  active: TabKey
  onChange: (key: TabKey) => void
  hidden?: boolean
  navRef?: RefObject<HTMLElement | null>
  /** 有没有进行中的出勤 —— 决定中间按钮显示「出勤」还是「进行中」 */
  tripActive: boolean
  /** 点中间按钮：没出勤就进开始出勤，正在出勤就回正在出勤页 */
  onTripPress: () => void
}

export default function BottomNav({
  active,
  onChange,
  hidden = false,
  navRef,
  tripActive,
  onTripPress,
}: BottomNavProps) {
  const renderTab = ({ key, label, Icon }: TabItem) => (
    <button
      key={key}
      type="button"
      className={`bottom-nav__item${active === key ? ' bottom-nav__item--active' : ''}`}
      onClick={() => onChange(key)}
      aria-current={active === key ? 'page' : undefined}
    >
      <Icon size={22} />
      <span className="bottom-nav__label">{label}</span>
    </button>
  )

  return (
    <nav
      ref={navRef}
      className={`bottom-nav${hidden ? ' bottom-nav--hidden' : ''}`}
      aria-label="主导航"
    >
      {LEFT_TABS.map(renderTab)}

      <div className="bottom-nav__center">
        <button
          type="button"
          className={`trip-fab${tripActive ? ' trip-fab--live' : ''}${
            active === 'trip' && !tripActive ? ' trip-fab--current' : ''
          }`}
          onClick={onTripPress}
          aria-label={tripActive ? '进行中的出勤，查看详情' : '开始出勤'}
        >
          <span className="trip-fab__icon">
            {/* 进行中的呼吸光晕：纯装饰，去掉也不影响按钮含义 */}
            <span className="trip-fab__glow" aria-hidden="true" />
            <span className="trip-fab__badge">
              <RodIcon size={26} />
            </span>
          </span>
          <span className="trip-fab__label">{tripActive ? '进行中' : '出勤'}</span>
        </button>
      </div>

      {RIGHT_TABS.map(renderTab)}
    </nav>
  )
}
