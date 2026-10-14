import { CATEGORY_META, type GearCategory } from '../types/gear'
import { CATEGORY_ICONS } from './icons'
import './CategoryCard.css'

interface CategoryCardProps {
  category: GearCategory
  count: number
  active: boolean
  onSelect: (category: GearCategory) => void
}

export default function CategoryCard({
  category,
  count,
  active,
  onSelect,
}: CategoryCardProps) {
  const meta = CATEGORY_META[category]
  const Icon = CATEGORY_ICONS[category]

  return (
    <button
      type="button"
      className={`category-card${active ? ' category-card--active' : ''}`}
      data-category={category}
      onClick={() => onSelect(category)}
      aria-pressed={active}
    >
      <span className="category-card__icon">
        <Icon size={22} />
      </span>
      <span className="category-card__label">{meta.label}</span>
      <span className="category-card__count">
        {count}
        <em>{meta.unit}</em>
      </span>
      <span className="category-card__desc">{meta.desc}</span>
    </button>
  )
}
