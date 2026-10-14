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
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
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
