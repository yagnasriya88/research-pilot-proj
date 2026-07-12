import { useState } from 'react'

interface Props {
  title: string
  label?: string
  initialValue?: string
  confirmLabel?: string
  onClose: () => void
  onConfirm: (value: string) => void
}

export function PromptModal({ title, label, initialValue = '', confirmLabel = 'Save', onClose, onConfirm }: Props) {
  const [value, setValue] = useState(initialValue)

  function submit() {
    if (!value.trim()) return
    onConfirm(value.trim())
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{title}</div>
        <div className="modal-body">
          {label && <label className="field-label">{label}</label>}
          <input
            className="text-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!value.trim()} onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
