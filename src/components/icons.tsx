interface IconProps {
  size?: number
  className?: string
}

function svgProps({ size = 24, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
    focusable: false,
  }
}

/** 鱼竿 */
export function RodIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.8 20.2 20.2 3.8" />
      <path d="M3.8 20.2 7.6 16.4" strokeWidth={3} />
      <circle cx="11.4" cy="12.6" r="1.5" />
      <circle cx="15.6" cy="8.4" r="1.2" />
    </svg>
  )
}

/** 渔轮 */
export function ReelIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="11.5" cy="13" r="6.2" />
      <circle cx="11.5" cy="13" r="2.3" />
      <path d="M11.5 6.8V3.6M8.8 3.6h5.4" />
      <path d="M17.7 11.6h2.5a1.4 1.4 0 0 1 0 2.8h-2.5" />
    </svg>
  )
}

/** 拟饵 */
export function LureIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.2 12c2.6-4.1 7.6-5.3 11.4-3l5.3-2.6v11.2L14.6 15C10.8 17.3 5.8 16.1 3.2 12Z" />
      <circle cx="7.8" cy="11.4" r="0.9" fill="currentColor" stroke="none" />
      <path d="M12 15.2v2.2a1.6 1.6 0 1 0 3.2 0" strokeWidth={1.5} />
    </svg>
  )
}

/** 周边装备 */
export function AccessoryIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4.6 8.4h14.8l-1.1 10.6a1.6 1.6 0 0 1-1.6 1.4H7.3a1.6 1.6 0 0 1-1.6-1.4Z" />
      <path d="M8.9 8.4V7a3.1 3.1 0 0 1 6.2 0v1.4" />
      <path d="M9.7 12.6h4.6" strokeWidth={1.4} />
    </svg>
  )
}

/** 底部导航：装备 */
export function BoxIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3 20.4 7.5v9L12 21 3.6 16.5v-9Z" />
      <path d="M3.6 7.5 12 12l8.4-4.5M12 12v9" />
    </svg>
  )
}

/** 底部导航：钓点 */
export function PinIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 21.2s6.2-5.6 6.2-10.2a6.2 6.2 0 1 0-12.4 0C5.8 15.6 12 21.2 12 21.2Z" />
      <circle cx="12" cy="10.8" r="2.3" />
    </svg>
  )
}

/** 底部导航：渔获 */
export function FishIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.4 12c2.5-4 7.3-5.2 11-3l5.2-2.6v11.2L14.4 15c-3.7 2.2-8.5 1-11-3Z" />
      <circle cx="7.9" cy="11.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 底部导航：我的 */
export function UserIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="8" r="3.7" />
      <path d="M4.6 20.4c0-3.9 3.3-6.4 7.4-6.4s7.4 2.5 7.4 6.4" />
    </svg>
  )
}

/** 添加 */
export function PlusIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 5.4v13.2M5.4 12h13.2" />
    </svg>
  )
}

/** 搜索 */
export function SearchIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="11" cy="11" r="6.4" />
      <path d="M15.7 15.7 20.4 20.4" />
    </svg>
  )
}

/** 关闭 */
export function CloseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
    </svg>
  )
}

/** 删除 */
export function TrashIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4.6 6.8h14.8M9.6 6.8V5.2a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.6" />
      <path d="M6.8 6.8 7.7 19a1.4 1.4 0 0 0 1.4 1.3h5.8A1.4 1.4 0 0 0 16.3 19l.9-12.2" />
      <path d="M10.4 10.4v6M13.6 10.4v6" />
    </svg>
  )
}

/** 星标（常用标记） */
export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...svgProps(props)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.8l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 17.1l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z" />
    </svg>
  )
}

/** 开始出勤 */
export function PlayIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8.2 5.6 18.4 12 8.2 18.4Z" fill="currentColor" />
    </svg>
  )
}

/** 结束出勤 */
export function StopIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.6" />
    </svg>
  )
}

/** 出勤计时 */
export function ClockIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="7.8" />
      <path d="M12 7.4V12l3.2 2" />
    </svg>
  )
}

/** 渔获照片 */
export function CameraIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4.4 8.6h2.9l1.3-2.1h6.8l1.3 2.1h2.9a1.4 1.4 0 0 1 1.4 1.4v7.2a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 17.2V10a1.4 1.4 0 0 1 1.4-1.4Z" />
      <circle cx="12" cy="13.1" r="3.1" />
    </svg>
  )
}

/** 返回上一级 */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M19 12H5M11.4 5.6 5 12l6.4 6.4" />
    </svg>
  )
}

/** 进入下一级 */
export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9.6 5.6 16 12l-6.4 6.4" />
    </svg>
  )
}

/** 已选中 */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5.6 12.6 9.8 16.8 18.4 7.6" />
    </svg>
  )
}

/** 获取当前位置 */
export function LocateIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="6.6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8" />
    </svg>
  )
}

/** 地图 / 轨迹 */
export function MapIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9.2 4.4 3.6 6.6v12.8l5.6-2.2 5.6 2.2 5.6-2.2V4.4l-5.6 2.2Z" />
      <path d="M9.2 4.4v12.8M14.8 6.6v12.8" />
    </svg>
  )
}

/** 暂停 */
export function PauseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9.2 5.8v12.4M14.8 5.8v12.4" strokeWidth={2.2} />
    </svg>
  )
}

/** 重试 / 刷新 */
export function RefreshIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.2 4.4v4.4h-4.4" />
    </svg>
  )
}

/** 当前位置 / 导航箭头 */
export function NavigationIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3.4 19 20.4l-7-3.3-7 3.3Z" />
    </svg>
  )
}

/* ------------------------- 首页 / 我的 / 天气 ------------------------- */

/** 底部导航：首页 */
export function HomeIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 10.6 12 3.8l8 6.8" />
      <path d="M5.8 9.6v10.2h12.4V9.6" />
      <path d="M9.9 19.8v-5.4h4.2v5.4" />
    </svg>
  )
}

/** 晴 */
export function SunIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </svg>
  )
}

/** 多云 / 阴 */
export function CloudIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M7.6 18.4h9a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.6 1.4 3.4 3.4 0 0 0 1.2 6.6Z" />
    </svg>
  )
}

/** 雨 */
export function RainIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M7.8 15.4h8.6a3.9 3.9 0 0 0 .4-7.8 5.5 5.5 0 0 0-10.4 1.4 3.3 3.3 0 0 0 1.4 6.4Z" />
      <path d="M9.2 18.2 8.2 21M12.4 18.2 11.4 21M15.6 18.2 14.6 21" />
    </svg>
  )
}

/** 雪 */
export function SnowIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M7.8 14.6h8.6a3.9 3.9 0 0 0 .4-7.8A5.5 5.5 0 0 0 6.4 8.2a3.3 3.3 0 0 0 1.4 6.4Z" />
      <path d="M9.4 17.6h.02M12 19.2h.02M14.6 17.6h.02" strokeWidth={2.4} />
    </svg>
  )
}

/** 风 */
export function WindIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.6 8.6h9.2a2.6 2.6 0 1 0-2.6-2.6" />
      <path d="M3.6 15.4h12.6a2.6 2.6 0 1 1-2.6 2.6" />
      <path d="M3.6 12h6" />
    </svg>
  )
}

/** 气温 */
export function ThermoIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M13.8 13.5V5.4a1.8 1.8 0 1 0-3.6 0v8.1a3.6 3.6 0 1 0 3.6 0Z" />
    </svg>
  )
}

/** 湿度 / 降水 */
export function DropIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3.4c3.2 3.9 5.2 6.6 5.2 9a5.2 5.2 0 1 1-10.4 0c0-2.4 2-5.1 5.2-9Z" />
    </svg>
  )
}

/** 最大长度 */
export function RulerIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.4 14.6 14.6 3.4l6 6L9.4 20.6Z" />
      <path d="M7.2 10.8l1.8 1.8M10.4 7.6l1.8 1.8M13.6 4.4l1.8 1.8" strokeWidth={1.4} />
    </svg>
  )
}

/** 最大重量 */
export function WeightIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4.2 19.4h15.6l-2.5-11H6.7Z" />
      <circle cx="12" cy="6.4" r="2.4" />
    </svg>
  )
}

/** 鱼种数量 */
export function LayersIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3.6 20.4 8 12 12.4 3.6 8Z" />
      <path d="M3.6 12.4 12 16.8l8.4-4.4M3.6 16.2 12 20.6l8.4-4.4" />
    </svg>
  )
}

/** 筛选 */
export function FilterIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.8 6.4h16.4l-6.3 7.2v5.6l-3.8 1.8v-7.4Z" />
    </svg>
  )
}

/** 排序 */
export function SortIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M7 4.6v14.8M7 19.4 4 16.2M7 19.4l3-3.2" />
      <path d="M13.4 6.2h6.8M13.4 12h5M13.4 17.8h3.2" />
    </svg>
  )
}

/** 时间范围 */
export function CalendarIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.8" y="5.4" width="16.4" height="14.8" rx="2.4" />
      <path d="M3.8 10.2h16.4M8.4 3.6v3.4M15.6 3.6v3.4" />
    </svg>
  )
}

/**
 * 分类图标表。分类卡片、表单的分类选择、详情页、装备图片、默认示意图都用这一张表，
 * 新增分类时只在这里加一行，不会出现「五个地方只改了四个」的漏改。
 */
export const CATEGORY_ICONS = {
  rod: RodIcon,
  reel: ReelIcon,
  lure: LureIcon,
  accessory: AccessoryIcon,
} as const
