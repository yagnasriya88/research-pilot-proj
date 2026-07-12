import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { notebooksApi } from '../api/notebooks'
import type { NotebookSummary } from '../api/types'
import { EmptyState } from './EmptyState'

interface Props {
  text: string
  onClose: () => void
  onSaved: (noteId: string, mode: 'append' | 'create') => void
}

export function SaveToNotebookModal({ text, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<'append' | 'create'>('append')
  const [notes, setNotes] = useState<NotebookSummary[]>([])
  const [search, setSearch] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    notebooksApi.list().then(setNotes)
  }, [])

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q))
  }, [notes, search])

  const canConfirm = mode === 'append' ? !!selectedNoteId : newTitle.trim().length > 0

  async function handleConfirm() {
    if (!canConfirm || busy) return
    setBusy(true)
    try {
      if (mode === 'append' && selectedNoteId) {
        const current = await notebooksApi.get(selectedNoteId)
        const merged = current.content ? `${current.content}\n\n---\n\n${text}` : text
        await notebooksApi.update(selectedNoteId, { content: merged })
        onSaved(selectedNoteId, 'append')
      } else {
        const created = await notebooksApi.create(newTitle.trim(), text)
        onSaved(created.id, 'create')
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Save to Notes
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="notes-modal-tabs">
            <div
              className={`notes-modal-tab${mode === 'append' ? ' active' : ''}`}
              onClick={() => setMode('append')}
            >
              Append to existing note
            </div>
            <div
              className={`notes-modal-tab${mode === 'create' ? ' active' : ''}`}
              onClick={() => setMode('create')}
            >
              Create new note
            </div>
          </div>

          {mode === 'append' ? (
            <>
              <input
                className="text-input ref-search"
                placeholder="Search notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {filteredNotes.length === 0 && (
                <EmptyState title="No notes yet" description="Create one instead using the tab above." />
              )}
              {filteredNotes.map((n) => (
                <label key={n.id} className="checkbox-row">
                  <input
                    type="radio"
                    name="save-to-note"
                    checked={selectedNoteId === n.id}
                    onChange={() => setSelectedNoteId(n.id)}
                  />
                  <div style={{ flex: 1 }}>
                    <div className="paper-row-title">{n.title}</div>
                    <div className="paper-row-meta">{n.snippet || 'Empty note'}</div>
                  </div>
                </label>
              ))}
            </>
          ) : (
            <>
              <label className="field-label">Title</label>
              <input
                className="text-input"
                autoFocus
                placeholder="Untitled Note"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </>
          )}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canConfirm || busy} onClick={handleConfirm}>
            {mode === 'append' ? 'Append' : 'Create Note'}
          </button>
        </div>
      </div>
    </div>
  )
}
