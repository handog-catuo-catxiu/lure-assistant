import { useEffect, useId, useMemo, useRef, useState } from 'react'
import BrandTile from './BrandTile'
import { findBrand, searchBrands } from '../lib/brandLogo'
import './BrandPicker.css'

interface BrandPickerProps {
  /** 当前品牌文字。允许是品牌库里没有的写法，原样保留 */
  value: string
  onChange: (value: string) => void
  inputId?: string
  placeholder?: string
}

/**
 * 品牌选择框：既能从内置品牌库里搜着选，也能直接手打。
 *
 * 输入框本身就是普通文本输入（所以「原来是什么品牌」永远原样显示），
 * 下面挂一个候选列表，点一条就把规范名称填进去。中英文和别名都能搜。
 *
 * 收起列表用的是 document 上的 pointerdown，而不是输入框的 blur：
 * blur 会在点击候选项之前触发，列表先消失、这一下就点空了。
 */
export default function BrandPicker({
  value,
  onChange,
  inputId,
  placeholder = '例如 达亿瓦',
}: BrandPickerProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const suggestions = useMemo(() => searchBrands(value, 8), [value])
  const visible = open && suggestions.length > 0

  // 高亮位在改动关键字时归零（在 onChange 里做，不用 effect），
  // 品牌库自动填充等外部改动可能让序号越界，读取时再夹一次
  const active =
    suggestions.length > 0 ? Math.min(activeIndex, suggestions.length - 1) : 0

  // 点/摸到组件外面就收起来
  useEffect(() => {
    if (!visible) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [visible])

  /** 手打的写法如果能对上品牌库，提示一下会用哪个品牌的 Logo */
  const matched = useMemo(() => {
    const entry = findBrand(value)
    if (!entry || entry.name === value.trim()) return null
    return entry
  }, [value])

  function commit(name: string) {
    onChange(name)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!visible) {
      // 还没展开时按方向键也能拉出候选
      if (event.key === 'ArrowDown' && suggestions.length > 0) {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((active + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((active - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      // 列表开着的时候回车是「选中」，不能让它提交整个表单
      event.preventDefault()
      commit(suggestions[active].entry.name)
    }
  }

  return (
    <div className="brand-picker" ref={wrapRef}>
      <input
        id={inputId}
        className="form__input"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-autocomplete="list"
      />

      {visible && (
        <ul className="brand-picker__list" id={listId} role="listbox">
          {suggestions.map(({ entry, latin }, index) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`brand-picker__item${
                  index === active ? ' brand-picker__item--active' : ''
                }`}
                role="option"
                aria-selected={index === active}
                onClick={() => commit(entry.name)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {/* 复用首页那一套品牌标记：同一个组件、同一套 Logo 素材 */}
                <BrandTile brand={entry.name} />
                <span className="brand-picker__text">
                  <span className="brand-picker__name">{entry.name}</span>
                  {latin && <span className="brand-picker__latin">{latin}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 候选列表已经明明白白列出这个品牌时就不用再提示一遍了 */}
      {!visible && matched && (
        <p className="brand-picker__hint">
          已识别为「{matched.name}」，保存后按{matched.name}显示品牌标记
        </p>
      )}
    </div>
  )
}
