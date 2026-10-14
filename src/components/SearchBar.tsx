import { CloseIcon, SearchIcon } from './icons'
import './SearchBar.css'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchBar({
  value,
  onChange,
  placeholder = '搜索名称、品牌、型号或规格',
}: SearchBarProps) {
  return (
    <div className="search-bar">
      <SearchIcon size={18} className="search-bar__icon" />
      <input
        className="search-bar__input"
        type="text"
        inputMode="search"
        enterKeyHint="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="搜索装备"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="search-bar__clear"
          onClick={() => onChange('')}
          aria-label="清除搜索内容"
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  )
}
