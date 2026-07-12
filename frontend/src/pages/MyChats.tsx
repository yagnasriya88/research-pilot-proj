import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { LayoutGrid, Search, MessageCircle, FileText, Pencil, Trash2 } from 'lucide-react'
import { chatsApi } from '../api/chats'
import type { ChatSummary, ChatType } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { PromptModal } from '../components/PromptModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../toast/ToastContext'

const FILTERS: { value: ChatType | 'all'; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'All', icon: LayoutGrid },
  { value: 'search', label: 'AI Search', icon: Search },
  { value: 'chat_with_pdf', label: 'Chat with PDF', icon: MessageCircle },
  { value: 'deep_research', label: 'Deep Research', icon: FileText },
]

const TYPE_LABEL: Record<ChatType, string> = {
  chat_with_pdf: 'Chat with PDF',
  search: 'AI Search',
  deep_research: 'Deep Research',
}

export function MyChats() {
  const navigate = useNavigate()
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ChatType | 'all'>('all')
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const { showToast } = useToast()

  function refresh() {
    chatsApi.list().then(setChats)
  }

  useEffect(refresh, [])

  async function handleRename(id: string, title: string) {
    await chatsApi.rename(id, title)
    showToast('Chat renamed')
    refresh()
  }

  async function handleDelete(id: string) {
    await chatsApi.remove(id)
    showToast('Chat deleted')
    refresh()
  }

  const filtered = chats
    .filter((c) => filter === 'all' || c.type === filter)
    .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))

  function meta(c: ChatSummary): string {
    if (c.type === 'chat_with_pdf') {
      const folderNames = c.sources.folders.map((f) => f.name)
      const paperNames = c.sources.papers.map((p) => p.title)
      return [...folderNames, ...paperNames].join(', ') || 'No sources yet'
    }
    return TYPE_LABEL[c.type]
  }

  return (
    <div className="dashboard dashboard--wide">
      <h2 style={{ marginBottom: 16 }}>My Chats</h2>
      <input
        className="ref-search"
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="Search chats..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`btn btn-pill${filter === f.value ? ' selected' : ''}`}
            onClick={() => setFilter(f.value)}
          >
            <f.icon size={14} /> {f.label}
          </button>
        ))}
      </div>
      <div className="card-list">
        {filtered.length === 0 && <EmptyState title="No chats found" />}
        {filtered.map((c) => (
          <div key={c.id} className="list-card" onClick={() => navigate(`/chats/${c.id}`)}>
            <div style={{ minWidth: 0 }}>
              <div className="list-card-title">{c.title}</div>
              <div className="list-card-meta">{meta(c)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
              <span className="list-card-meta">{new Date(c.updatedAt).toLocaleDateString()}</span>
              <button
                className="btn btn-icon"
                onClick={() => setRenameTarget({ id: c.id, title: c.title })}
                aria-label="Rename chat"
                title="Rename"
              >
                <Pencil size={14} />
              </button>
              <button
                className="btn btn-icon btn-danger-ghost"
                onClick={() => setDeleteTarget({ id: c.id, title: c.title })}
                aria-label="Delete chat"
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
          title="Rename chat"
          label="Title"
          initialValue={renameTarget.title}
          confirmLabel="Rename"
          onClose={() => setRenameTarget(null)}
          onConfirm={(title) => handleRename(renameTarget.id, title)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete this chat?"
          description={`"${deleteTarget.title}" will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget.id)}
        />
      )}
    </div>
  )
}
