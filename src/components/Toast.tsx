import './Toast.css'

interface ToastProps {
  message: string | null
}

/** 底部轻提示，可跨弹窗显示 */
export default function Toast({ message }: ToastProps) {
  if (!message) return null

  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
