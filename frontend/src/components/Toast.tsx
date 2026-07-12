import { CheckCircle2, X, XCircle } from 'lucide-react'
import { useToast } from '../toast/ToastContext'

export function ToastStack() {
  const { toasts, dismissToast } = useToast()
  if (toasts.length === 0) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.variant}`}>
          {t.variant === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span className="toast-message">{t.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
