import { useEffect, type ReactNode } from 'react'
import { CloseIcon } from './icons'
import './Modal.css'

interface ModalProps {
  title: string
  subtitle?: string
  children: ReactNode
  /** 底部操作区，通常放按钮 */
  footer?: ReactNode
  onClose: () => void
}

/**
 * 当前打开着的弹窗，按打开顺序排列。
 *
 * 弹窗可以叠着开（标点表单里再打开地图选点），这时只有最上面那层
 * 该响应 ESC、该管页面的滚动锁定；否则按一次 ESC 会把两层一起关掉。
 */
const openModals: symbol[] = []

/**
 * 通用弹窗：手机端从底部升起的浮层，桌面端居中显示。
 * 支持 ESC 关闭、点击遮罩关闭、打开时锁定背景滚动。
 */
export default function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
}: ModalProps) {
  useEffect(() => {
    const token = Symbol('modal')
    openModals.push(token)

    function handleKey(event: KeyboardEvent) {
      // 只有最上面那层响应 ESC，下面被压住的弹窗不跟着一起关
      if (event.key === 'Escape' && openModals[openModals.length - 1] === token) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKey)
      const index = openModals.indexOf(token)
      if (index >= 0) openModals.splice(index, 1)
      // 还有别的弹窗开着就保持锁定，别把滚动条提前还给页面
      if (openModals.length === 0) document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__overlay" onClick={onClose} />

      <div className="modal__sheet">
        <header className="modal__head">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="modal__body">{children}</div>

        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}
