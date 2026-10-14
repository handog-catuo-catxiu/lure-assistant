import Modal from './Modal'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  title: string
  message: string
  /** 需要二次确认的高亮内容，例如装备名称 */
  highlight?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  highlight,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div className="confirm">
        <p className="confirm__message">{message}</p>
        {highlight && <p className="confirm__highlight">{highlight}</p>}
        <p className="confirm__hint">删除后无法恢复，请确认。</p>
      </div>
    </Modal>
  )
}
