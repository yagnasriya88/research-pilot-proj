import type { LucideIcon } from 'lucide-react'
import { AlertCircle, Inbox } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  variant?: 'empty' | 'error'
}

export function EmptyState({ icon: Icon, title, description, action, variant = 'empty' }: EmptyStateProps) {
  const ResolvedIcon = Icon ?? (variant === 'error' ? AlertCircle : Inbox)
  return (
    <div className={`empty-state-block empty-state-block--${variant}`}>
      <ResolvedIcon size={26} strokeWidth={1.5} />
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-description">{description}</div>}
      {action && (
        <button type="button" className="btn btn-sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
