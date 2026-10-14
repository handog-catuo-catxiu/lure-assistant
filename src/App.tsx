import { useState } from 'react'
import BottomNav, { type TabKey } from './components/BottomNav'
import ComingSoon from './components/ComingSoon'
import GearPage from './pages/GearPage'
import { useDockVisibility } from './hooks/useDockVisibility'
import './App.css'

const TAB_TITLES: Record<TabKey, string> = {
  gear: '装备',
  spot: '钓点',
  catch: '渔获',
  mine: '我的',
}

function App() {
  const [tab, setTab] = useState<TabKey>('gear')
  // 传入 tab 作为 resetKey：切换底部导航页时 Dock 会重新显示
  const { contentRef, navRef, hidden } = useDockVisibility(tab)

  return (
    <div className="app-shell">
      {/* Dock 的显隐只改 transform，不给 .app-main 加类名：
          内容高度一旦跟着变，文档高度就会变，滚动位置被钳制后会被误判成反向滚动 */}
      <main className="app-main" ref={contentRef}>
        {tab === 'gear' ? (
          <GearPage />
        ) : (
          <ComingSoon title={TAB_TITLES[tab]} />
        )}
      </main>

      <BottomNav
        active={tab}
        onChange={setTab}
        hidden={hidden}
        navRef={navRef}
      />
    </div>
  )
}

export default App
