import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Pencil, Trash2, BookMarked } from 'lucide-react'
import { booksApi } from '../api/books'
import type { Book } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { PromptModal } from '../components/PromptModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../toast/ToastContext'

const STATUS_LABEL: Record<Book['ingestionStatus'], string> = {
  pending: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
}

export function MyBooks() {
  const navigate = useNavigate()
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

  function refresh() {
    return booksApi.list().then((data) => {
      setBooks(data)
      setLoading(false)
      return data
    })
  }

  useEffect(() => {
    refresh()
  }, [])

  // Book ingestion runs as a background task (unlike papers, which ingest inline
  // before the upload response returns), so the list needs to poll while anything is
  // still pending/processing rather than relying on a single fetch after upload.
  useEffect(() => {
    const hasInFlight = books.some((b) => b.ingestionStatus === 'pending' || b.ingestionStatus === 'processing')
    if (!hasInFlight) return
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [books])

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      await booksApi.upload(file)
      showToast('Book uploaded — processing in the background')
      await refresh()
    } catch {
      showToast('Failed to upload book', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleRename(id: string, title: string) {
    await booksApi.update(id, { title })
    showToast('Book renamed')
    refresh()
  }

  async function handleDelete(id: string) {
    await booksApi.remove(id)
    showToast('Book deleted')
    refresh()
  }

  return (
    <div className="dashboard dashboard--wide">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>My Books</h2>
        <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={14} /> {uploading ? 'Uploading...' : 'Upload Book'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleUpload(file)
            e.target.value = ''
          }}
        />
      </div>

      {!loading && books.length === 0 && (
        <EmptyState
          icon={BookMarked}
          title="No books yet"
          description="Upload a PDF to start chatting with a full book, grounded in its own content."
          action={{ label: 'Upload Book', onClick: () => fileInputRef.current?.click() }}
        />
      )}

      <div className="card-list">
        {books.map((b) => (
          <div
            key={b.id}
            className="list-card"
            onClick={() => b.ingestionStatus === 'ready' && navigate(`/books/${b.id}/read`)}
            style={{ cursor: b.ingestionStatus === 'ready' ? 'pointer' : 'default' }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="list-card-title">{b.title}</div>
              <div className="list-card-meta">
                {b.author || 'Unknown author'}
                {b.pageCount ? ` · ${b.pageCount} pages` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
              <span className={`status-badge status-${b.ingestionStatus}`}>{STATUS_LABEL[b.ingestionStatus]}</span>
              <span className="list-card-meta">{new Date(b.createdAt).toLocaleDateString()}</span>
              <button
                className="btn btn-icon"
                onClick={() => setRenameTarget({ id: b.id, title: b.title })}
                aria-label="Rename book"
                title="Rename"
              >
                <Pencil size={14} />
              </button>
              <button
                className="btn btn-icon btn-danger-ghost"
                onClick={() => setDeleteTarget({ id: b.id, title: b.title })}
                aria-label="Delete book"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {renameTarget && (
        <PromptModal
          title="Rename book"
          label="Title"
          initialValue={renameTarget.title}
          confirmLabel="Rename"
          onClose={() => setRenameTarget(null)}
          onConfirm={(title) => handleRename(renameTarget.id, title)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete this book?"
          description={`"${deleteTarget.title}" and its chat history will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget.id)}
        />
      )}
    </div>
  )
}
