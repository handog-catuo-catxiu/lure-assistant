import PageHeader from '../components/PageHeader'
import { ChevronRightIcon, ClockIcon, FishIcon, LayersIcon } from '../components/icons'
import { ALL_SPECIES } from '../lib/fish/encyclopedia'
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
  onOpenCatches: () => void
  onOpenTrips: () => void
  onOpenSpeciesList: () => void
}

export default function MinePage({
  trip,
  onOpenCatches,
  onOpenTrips,
  onOpenSpeciesList,
}: MinePageProps) {
  const catchCount = trip.catches.length
  const tripCount = trip.sessions.length

  return (
    <div className="mine">
      <PageHeader title="我的" subtitle="记录都存在本机，不上传服务器" />

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
        <p>清理浏览器数据会一并清掉这些记录，重要的渔获建议另外留存照片。</p>
      </section>
    </div>
  )
}
