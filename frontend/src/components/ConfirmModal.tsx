interface Props {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
}

export function ConfirmModal({ title, description, confirmLabel = 'Confirm', danger = true, onClose, onConfirm }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{title}</div>
        {description && <div className="modal-body">{description}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
