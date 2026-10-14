import { useId } from 'react'
import { CATEGORY_META, type GearCategory } from '../types/gear'
import { CATEGORY_ICONS } from './icons'
import './GearPlaceholder.css'

interface GearPlaceholderProps {
  category: GearCategory
  className?: string
}

/**
 * 分类默认示意图：统一风格的线稿占位图，不是任何真实产品的照片。
 * 界面上会同时标注「示意图」，避免被误认为是实物照片。
 */
export default function GearPlaceholder({
  category,
  className,
}: GearPlaceholderProps) {
  const gradientId = useId()
  const Icon = CATEGORY_ICONS[category]

  return (
    <svg
      className={`gear-placeholder${className ? ` ${className}` : ''}`}
      data-category={category}
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`${CATEGORY_META[category].label}示意图`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop className="gear-placeholder__stop-a" offset="0%" />
          <stop className="gear-placeholder__stop-b" offset="100%" />
        </linearGradient>
      </defs>

      <rect width="320" height="200" fill={`url(#${gradientId})`} />

      <g className="gear-placeholder__waves">
        <path d="M-20 148 q 40 -16 80 0 t 80 0 t 80 0 t 80 0" />
        <path d="M-20 172 q 40 -16 80 0 t 80 0 t 80 0 t 80 0" />
      </g>

      <g className="gear-placeholder__icon" transform="translate(124 64)">
        <Icon size={72} />
      </g>
    </svg>
  )
}
