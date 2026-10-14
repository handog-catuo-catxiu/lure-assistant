import './Header.css'

interface HeaderProps {
  /** 装备总数 */
  total: number
  /** 常用装备数 */
  favoriteCount: number
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '凌晨好'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export default function Header({ total, favoriteCount }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__top">
        <div className="header__brand">
          <span className="header__logo" aria-hidden="true">
            🎣
          </span>
          <div>
            <h1 className="header__title">路亚助手</h1>
            <p className="header__slogan">管好装备，出门不落东西</p>
          </div>
        </div>
      </div>

      <p className="header__welcome">
        {greeting()}，钓友！今天想去哪儿抛两竿？
      </p>

      <div className="header__stats">
        <div className="header__stat">
          <strong>{total}</strong>
          <span>装备总数</span>
        </div>
        <div className="header__divider" />
        <div className="header__stat">
          <strong>{favoriteCount}</strong>
          <span>常用装备</span>
        </div>
      </div>
    </header>
  )
}
