import './ToggleSwitch.css'

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 供读屏使用；界面上的可见文字由使用方自己渲染 */
  label: string
  /** 用隐式关联（input 位于 label 内）时可以省略 */
  id?: string
}

/**
 * 开关控件，样式与原来的「设为常用装备」开关完全一致。
 * 既可以放进已有的 label 行里，也可以单独使用。
 */
export default function ToggleSwitch({
  checked,
  onChange,
  label,
  id,
}: ToggleSwitchProps) {
  return (
    <span className="switch">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" aria-hidden="true" />
    </span>
  )
}
