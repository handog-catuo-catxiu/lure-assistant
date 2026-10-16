import { useEffect, useState } from 'react'
import BottomNav, { type TabKey } from './components/BottomNav'
import ActiveTripPage from './pages/ActiveTripPage'
import CatchArchivePage from './pages/CatchArchivePage'
import CatchDetailPage from './pages/CatchDetailPage'
import GearPage from './pages/GearPage'
import HomePage from './pages/HomePage'
import MinePage from './pages/MinePage'
import SpotPage from './pages/SpotPage'
import SpeciesListPage from './pages/SpeciesListPage'
import SpeciesPage from './pages/SpeciesPage'
import StartTripPage from './pages/StartTripPage'
import TripDetailPage from './pages/TripDetailPage'
import TripPage from './pages/TripPage'
import { useCatchPhotos } from './hooks/useCatchPhotos'
import { useDockVisibility } from './hooks/useDockVisibility'
import { useGear } from './hooks/useGear'
import { useImageLibrary } from './hooks/useImageLibrary'
import { useTrip } from './hooks/useTrip'
import { useTripTrack } from './hooks/useTripTrack'
import { loadTrackPref, saveTrackPref } from './lib/trackStore'
import './App.css'

/**
 * 应用内的页面栈。没有引入路由库：出勤是一条直线流程
 * （列表 → 开始出勤 → 正在出勤 → 出勤总结 → 列表），
 * 加上「我的渔获」和单条渔获两个二级页，用一个状态就够了，也省掉一层依赖。
 */
type Route =
  | { name: 'tabs' }
  | { name: 'start' }
  | { name: 'active' }
  | { name: 'catches' }
  | { name: 'catch'; catchId: string }
  | { name: 'summary'; sessionId: string }
  /** backToCatchId：从某条渔获点进它的出勤时记一下，返回时回到那条渔获 */
  | { name: 'detail'; sessionId: string; backToCatchId?: string }
  /** 鱼类百科目录 */
  | { name: 'species-list' }
  /** 单条鱼的百科；back 记下是从首页推荐点进来的还是从百科目录点进来的 */
  | { name: 'species'; speciesId: string; back: 'home' | 'list' }

function App() {
  // 首页是默认页
  const [tab, setTab] = useState<TabKey>('home')
  const [route, setRoute] = useState<Route>({ name: 'tabs' })

  /*
   * 装备、出勤、渔获照片都在这里各建一份。
   * 装备页与出勤流程必须看到同一份数据，所以不能在页面里各调一次 hook。
   */
  const gear = useGear()
  const images = useImageLibrary()
  const trip = useTrip()
  const catchPhotos = useCatchPhotos()

  /*
   * 轨迹记录器放在最外层：整个应用里只有这一条高德定位循环，
   * 出勤流程来回切页也不会重复开监听器。首页的天气也复用它，
   * 不会为了天气再起第二条定位。
   */
  const activeSessionId = trip.activeSession?.id ?? null
  // 用户在这次出勤上是否同意记轨迹。刷新后沿用当时的答复，不会自己改成「记」
  const [wantTrack, setWantTrack] = useState(
    () => activeSessionId === null || (loadTrackPref(activeSessionId) ?? true),
  )
  const track = useTripTrack({ sessionId: activeSessionId, enabled: wantTrack })

  // 切换底部导航页时 Dock 恢复显示；进出流程页也重新绑定一次
  const dockKey = route.name === 'tabs' ? tab : route.name
  const { contentRef, navRef, hidden } = useDockVisibility(dockKey)

  // 流程页是从头看起的页面，进来先回到顶部
  useEffect(() => {
    if (route.name === 'tabs') return
    window.scrollTo({ top: 0 })
  }, [route])

  function changeTab(next: TabKey) {
    setTab(next)
    setRoute({ name: 'tabs' })
  }

  /** 出勤流程走完后回到出勤标签页，历史记录和刚结束的那场都在那儿 */
  function backToTripTab() {
    setTab('trip')
    setRoute({ name: 'tabs' })
  }

  /**
   * 底部中间的「出勤」按钮：没在出勤就进开始出勤流程，
   * 正在出勤就回到那场出勤的页面。**只切页面，不碰出勤状态** ——
   * 出勤的存在与否只由 useTrip 里的 activeSession 决定。
   */
  function handleTripPress() {
    const active = trip.activeSession
    setRoute(active ? { name: 'active' } : { name: 'start' })
  }

  function renderTabs() {
    if (tab === 'home') {
      return (
        <HomePage
          trip={trip}
          liveFix={track.latest}
          onResumeTrip={() => setRoute({ name: 'active' })}
          onOpenSpecies={(speciesId) => setRoute({ name: 'species', speciesId, back: 'home' })}
        />
      )
    }

    if (tab === 'gear') {
      return (
        <GearPage
          gear={gear}
          images={images}
          trip={trip}
          onStartTrip={() => setRoute({ name: 'start' })}
          onResumeTrip={() => setRoute({ name: 'active' })}
        />
      )
    }

    if (tab === 'spot') return <SpotPage trip={trip} />

    if (tab === 'mine') {
      return (
        <MinePage
          trip={trip}
          onOpenCatches={() => setRoute({ name: 'catches' })}
          onOpenTrips={() => changeTab('trip')}
          onOpenSpeciesList={() => setRoute({ name: 'species-list' })}
        />
      )
    }

    return (
      <TripPage
        trip={trip}
        onStart={() => setRoute({ name: 'start' })}
        onResume={() => setRoute({ name: 'active' })}
        onOpenDetail={(sessionId) => setRoute({ name: 'detail', sessionId })}
      />
    )
  }

  function renderRoute() {
    if (route.name === 'start') {
      return (
        <StartTripPage
          trip={trip}
          gear={gear}
          images={images}
          onCancel={backToTripTab}
          onStarted={(session, options) => {
            saveTrackPref(session.id, options.recordTrack)
            setWantTrack(options.recordTrack)
            setRoute({ name: 'active' })
          }}
        />
      )
    }

    if (route.name === 'active') {
      // 进行中的出勤没了（例如被结束或清空）就交回出勤页，不留在空页面上
      const session = trip.activeSession
      if (session) {
        return (
          <ActiveTripPage
            trip={trip}
            gear={gear}
            images={images}
            catchPhotos={catchPhotos}
            track={track}
            sessionId={session.id}
            onBack={backToTripTab}
            onEnded={(ended) =>
              setRoute({ name: 'summary', sessionId: ended.id })
            }
          />
        )
      }
      return (
        <TripPage
          trip={trip}
          onStart={() => setRoute({ name: 'start' })}
          onResume={() => setRoute({ name: 'active' })}
          onOpenDetail={(sessionId) => setRoute({ name: 'detail', sessionId })}
        />
      )
    }

    if (route.name === 'catches') {
      return (
        <CatchArchivePage
          trip={trip}
          catchPhotos={catchPhotos}
          onBack={() => changeTab('mine')}
          onOpenCatch={(catchId) => setRoute({ name: 'catch', catchId })}
          onStartTrip={() => setRoute({ name: 'start' })}
          onResumeTrip={() => setRoute({ name: 'active' })}
        />
      )
    }

    if (route.name === 'catch') {
      return (
        <CatchDetailPage
          trip={trip}
          gear={gear}
          catchPhotos={catchPhotos}
          catchId={route.catchId}
          currentLocation={track.latest}
          onBack={() => setRoute({ name: 'catches' })}
          onDeleted={() => setRoute({ name: 'catches' })}
          onOpenSession={(sessionId) =>
            setRoute({ name: 'detail', sessionId, backToCatchId: route.catchId })
          }
        />
      )
    }

    if (route.name === 'species-list') {
      return (
        <SpeciesListPage
          onBack={() => changeTab('mine')}
          onOpenSpecies={(speciesId) => setRoute({ name: 'species', speciesId, back: 'list' })}
        />
      )
    }

    if (route.name === 'species') {
      return (
        <SpeciesPage
          speciesId={route.speciesId}
          onBack={
            route.back === 'list'
              ? () => setRoute({ name: 'species-list' })
              : () => changeTab('home')
          }
          backLabel={route.back === 'list' ? '返回鱼类百科' : '返回首页'}
        />
      )
    }

    if (route.name === 'summary' || route.name === 'detail') {
      const backToCatchId = route.name === 'detail' ? route.backToCatchId : undefined
      return (
        <TripDetailPage
          trip={trip}
          gear={gear}
          catchPhotos={catchPhotos}
          track={track}
          sessionId={route.sessionId}
          variant={route.name === 'summary' ? 'summary' : 'history'}
          onBack={
            route.name === 'summary'
              ? backToTripTab
              : backToCatchId
                ? () => setRoute({ name: 'catch', catchId: backToCatchId })
                : () => setRoute({ name: 'tabs' })
          }
          onDone={backToTripTab}
        />
      )
    }

    return renderTabs()
  }

  return (
    <div className="app-shell">
      {/* Dock 的显隐只改 transform，不给 .app-main 加类名：
          内容高度一旦跟着变，文档高度就会变，滚动位置被钳制后会被误判成反向滚动 */}
      <main className="app-main" ref={contentRef}>
        {renderRoute()}
      </main>

      <BottomNav
        active={tab}
        onChange={changeTab}
        // 开始出勤、正在出勤这些流程页占满整屏，不显示底部导航
        hidden={hidden || route.name !== 'tabs'}
        navRef={navRef}
        tripActive={trip.activeSession !== null}
        onTripPress={handleTripPress}
      />
    </div>
  )
}

export default App
