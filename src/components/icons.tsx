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
