import { useEffect, useRef, useState, type RefObject } from 'react'

/** 顶部这段距离内一律视为「在顶部」，Dock 常驻显示（px） */
const TOP_ZONE = 8

/**
 * 判定滚动方向需要的累积位移（px）。两个方向故意不等：
 * 向上滚要立刻把 Dock 拉回来，门槛小、响应快；
 * 向下滚是「收起」这个更需要谨慎的动作，门槛大一些，
 * 手指轻微的抖动凑不满就不切换状态。
 */
const SHOW_THRESHOLD = 8
const HIDE_THRESHOLD = 14

/** 判定「到底」时的容差，抵消浮点误差（px） */
const BOTTOM_TOLERANCE = 16

/** 离开底部要多滚这么远才解除「到底」状态，避免在临界线上反复切（px） */
const BOTTOM_RELEASE = 24

/**
 * Dock 刚显示出来的这段时间内不响应「隐藏」判断（ms）。
 * 显示动画约 240ms，动画没跑完就被下一次滚动打断会看成反复闪动。
 */
const HIDE_COOLDOWN = 220

interface DockVisibility {
  /** 挂到滚动内容上，用来给它写入底部留白 */
  contentRef: RefObject<HTMLElement | null>
  /** 挂到 Dock 上，用来量它的真实高度（含 iPhone 底部安全区） */
  navRef: RefObject<HTMLElement | null>
  /** 当前是否应该隐藏 */
  hidden: boolean
}

/**
 * 根据页面滚动方向控制底部 Dock 的显示与隐藏：
 * 向下滚动收起，向上滚动立刻展开，回到顶部或滚到底部时常驻显示。
 *
 * 监听的是 document 的滚动，也就是 window 的 scroll 事件——
 * `.app-shell` 用的是 min-height，内容变高时它跟着长高，
 * 所以整页真正滚动的是文档，而不是里面的 `.app-main`。
 *
 * 弹窗打开时 Modal 会把 body 的 overflow 设为 hidden，文档滚不动，
 * 加上 `.modal__body` 的 overscroll-behavior: contain，弹窗里怎么滚都不会影响 Dock。
 *
 * @param resetKey 变化时重新绑定并强制显示，用于「切换底部导航页时 Dock 恢复显示」
 */
export function useDockVisibility(resetKey: unknown): DockVisibility {
  const contentRef = useRef<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const content = contentRef.current
    const nav = navRef.current
    if (!content || !nav) return

    // 重新绑定（例如切换了底部导航页）时先恢复显示
    setHidden(false)

    // Dock 是 position: fixed，不再占据布局空间，所以把它的真实高度写成
    // 滚动内容的底部留白，最后一条装备才不会被挡住。
    // 这段留白是恒定的：Dock 显示或隐藏都不去动它，否则文档高度会跟着变，
    // 引发新的滚动事件和位置钳制（见下方 decide 里的说明）。
    let dockSpace = nav.offsetHeight
    const syncDockSpace = () => {
      dockSpace = nav.offsetHeight
      content.style.setProperty('--dock-space', `${dockSpace}px`)
    }
    syncDockSpace()
    // 安全区、字体大小变化都会改变 Dock 高度，跟着同步
    const observer = new ResizeObserver(syncDockSpace)
    observer.observe(nav)

    let anchor = window.scrollY
    let isHidden = false
    let atBottom = false
    let shownAt = -Infinity
    let frame = 0

    // 状态没变就不调用 setState，避免每一次 scroll 都触发一轮重渲染
    const show = () => {
      if (!isHidden) return
      isHidden = false
      shownAt = performance.now()
      setHidden(false)
    }
    const hide = () => {
      if (isHidden) return
      isHidden = true
      setHidden(true)
    }

    const decide = () => {
      frame = 0

      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      )
      // iOS 惯性滚动到两端时橡皮筋回弹会让 scrollY 短暂越界（负数或超过 maxScroll），
      // 越界的那段位移不是用户真实意图，钳回有效区间再判断方向。
      const y = Math.min(Math.max(window.scrollY, 0), maxScroll)

      /*
       * 「到底」的界线取 maxScroll - dockSpace：底部留白恒定之后，
       * 留白正好在滚动位置进入文档最后 dockSpace 像素时露出来，
       * 从这一刻起让 Dock 回来，留白就永远被 Dock 盖着，不会出现空栏。
       * 再往前留 BOTTOM_TOLERANCE 的余量，让 Dock 有时间为露头做准备。
       * 离开时多退 BOTTOM_RELEASE 才解除，形成滞回，临界线上不会来回切。
       */
      const bottomLine = maxScroll - dockSpace - BOTTOM_TOLERANCE
      atBottom = atBottom ? y > bottomLine - BOTTOM_RELEASE : y >= bottomLine

      // 到底 或 在顶部：稳定显示，不做方向判断（内容不足一屏时 bottomLine 为负，同样落在这里）
      if (atBottom || y <= TOP_ZONE) {
        anchor = y
        show()
        return
      }

      const delta = y - anchor
      // anchor 只在真正做出判断时才前移，没到门槛的零碎位移会自动累加

      if (delta >= HIDE_THRESHOLD) {
        // 刚滑出来的 Dock 先站稳，动画跑完之前不响应收起
        if (performance.now() - shownAt >= HIDE_COOLDOWN) {
          anchor = y
          hide()
        }
        return
      }

      if (delta <= -SHOW_THRESHOLD) {
        // 向上滚：立刻展开，不用等回到顶部
        anchor = y
        show()
      }
    }

    // 滚动事件非常密集，合并成每帧只判断一次
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(decide)
    }

    // passive：这个监听器不会 preventDefault，交给浏览器优化滚动
    window.addEventListener('scroll', onScroll, { passive: true })
    decide()

    return () => {
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [resetKey])

  return { contentRef, navRef, hidden }
}
