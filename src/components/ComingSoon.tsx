import './ComingSoon.css'

interface ComingSoonProps {
  title: string
}

/** 未实现的页面占位，第一版仅装备页可用 */
export default function ComingSoon({ title }: ComingSoonProps) {
  return (
    <div className="coming-soon">
      <span className="coming-soon__emoji" aria-hidden="true">
        🚧
      </span>
      <h2>{title}</h2>
      <p>功能正在开发中，敬请期待</p>
    </div>
  )
}
