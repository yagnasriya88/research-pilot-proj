import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Link2, Globe, FileText, Upload, FilePen, BookOpen, Trash2, X, Menu } from 'lucide-react'
import { referencesApi } from '../api/references'
import type { Folder, Paper, Tag } from '../api/types'
import { EmptyState } from '../components/EmptyState'

const TAG_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#14b8a6']

function paperSourceLink(p: Paper): { href: string; icon: LucideIcon; label: string } | null {
  if (p.doi) return { href: `https://doi.org/${p.doi}`, icon: Link2, label: 'View via DOI' }
  if (p.sourceUrl) return { href: p.sourceUrl, icon: Globe, label: 'View source' }
  if (p.ingestionStatus === 'ready') return { href: `/api/references/papers/${p.id}/pdf`, icon: FileText, label: 'View stored PDF' }
  return null
}

export function ReferenceManager() {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [papers, setPapers] = useState<Paper[]>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [activeTagId, setActiveTagId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [hasPdfOnly, setHasPdfOnly] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [modal, setModal] = useState<'upload-file' | 'upload-url' | 'manual' | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [showNewTag, setShowNewTag] = useState(false)
  const [tagMenuFor, setTagMenuFor] = useState<string | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const [papersError, setPapersError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function refreshFolders() {
    referencesApi.listFolders().then(setFolders)
  }
  function refreshTags() {
    referencesApi.listTags().then(setTags)
  }
  function refreshPapers() {
    setPapersError(false)
    referencesApi
      .listPapers({
        folderId: activeFolderId ?? undefined,
        tagId: activeTagId ?? undefined,
        search: search || undefined,
        hasPdf: hasPdfOnly ? true : undefined,
      })
      .then(setPapers)
      .catch(() => setPapersError(true))
  }

  useEffect(refreshFolders, [])
  useEffect(refreshTags, [])
  useEffect(refreshPapers, [activeFolderId, activeTagId, search, hasPdfOnly])

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    await referencesApi.createFolder(newFolderName.trim())
    setNewFolderName('')
    setShowNewFolder(false)
    refreshFolders()
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return
    const color = TAG_COLORS[tags.length % TAG_COLORS.length]
    await referencesApi.createTag(newTagName.trim(), color)
    setNewTagName('')
    setShowNewTag(false)
    refreshTags()
  }

  async function handleFileUpload(file: File) {
    setModal(null)
    setAddMenuOpen(false)
    await referencesApi.uploadFile(file, activeFolderId)
    refreshPapers()
  }

  async function handleMoveToFolder(paperId: string, folderId: string | null) {
    await referencesApi.updatePaper(paperId, { folderId })
    refreshPapers()
  }

  async function handleToggleTag(paper: Paper, tagId: string) {
    const has = paper.tagIds.includes(tagId)
    const nextTagIds = has ? paper.tagIds.filter((t) => t !== tagId) : [...paper.tagIds, tagId]
    await referencesApi.updatePaper(paper.id, { tagIds: nextTagIds })
    refreshPapers()
  }

  async function handleDelete(paperId: string) {
    await referencesApi.deletePaper(paperId)
    refreshPapers()
  }

  return (
    <div className="reference-manager">
      {treeOpen && <div className="drawer-scrim" onClick={() => setTreeOpen(false)} />}
      <div className={`ref-tree${treeOpen ? ' open' : ''}`}>
        <div className="dropdown" style={{ width: '100%' }}>
          <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setAddMenuOpen((v) => !v)}>
            + Add Papers
          </button>
          {addMenuOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-item" onClick={() => setModal('upload-url')}>
                <span className="dropdown-item-label">
                  <Link2 size={14} /> Upload URL or DOI
                </span>
                <span className="dropdown-item-sub">Add a paper from its URL or DOI</span>
              </div>
              <div className="dropdown-item" onClick={() => fileInputRef.current?.click()}>
                <span className="dropdown-item-label">
                  <Upload size={14} /> Upload File
                </span>
                <span className="dropdown-item-sub">Import a PDF from your device</span>
              </div>
              <div className="dropdown-item" onClick={() => setModal('manual')}>
                <span className="dropdown-item-label">
                  <FilePen size={14} /> Add Manually
                </span>
                <span className="dropdown-item-sub">Enter citation data by hand</span>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
              e.target.value = ''
            }}
          />
        </div>

        <div className="ref-tree-section-title">Folders</div>
        <div className={`ref-tree-item${activeFolderId === null ? ' active' : ''}`} onClick={() => setActiveFolderId(null)}>
          All Papers
        </div>
        {folders.map((f) => (
          <div key={f.id} className={`ref-tree-item${activeFolderId === f.id ? ' active' : ''}`} onClick={() => setActiveFolderId(f.id)}>
            {f.name}
          </div>
        ))}
        {showNewFolder ? (
          <div style={{ padding: '6px 8px' }}>
            <input
              className="text-input"
              style={{ marginBottom: 4 }}
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              onBlur={handleCreateFolder}
            />
          </div>
        ) : (
          <div className="ref-tree-item" style={{ color: 'var(--text-muted)' }} onClick={() => setShowNewFolder(true)}>
            + New Folder
          </div>
        )}

        <div className="ref-tree-section-title">Tags</div>
        <div className={`ref-tree-item${activeTagId === null ? ' active' : ''}`} onClick={() => setActiveTagId(null)}>
          All
        </div>
        {tags.map((t) => (
          <div key={t.id} className={`ref-tree-item${activeTagId === t.id ? ' active' : ''}`} onClick={() => setActiveTagId(t.id)}>
            <span>
              <span className="tag-swatch" style={{ background: t.color }} />
              {t.name}
            </span>
          </div>
        ))}
        {showNewTag ? (
          <div style={{ padding: '6px 8px' }}>
            <input
              className="text-input"
              style={{ marginBottom: 4 }}
              autoFocus
              placeholder="Tag name"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              onBlur={handleCreateTag}
            />
          </div>
        ) : (
          <div className="ref-tree-item" style={{ color: 'var(--text-muted)' }} onClick={() => setShowNewTag(true)}>
            + New Tag
          </div>
        )}
      </div>

      <div className="ref-main">
        <div className="ref-toolbar">
          <button
            type="button"
            className="btn btn-icon btn-icon-sm ref-toolbar-tree-toggle"
            onClick={() => setTreeOpen(true)}
            aria-label="Open folders and tags"
          >
            <Menu size={15} />
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={hasPdfOnly} onChange={(e) => setHasPdfOnly(e.target.checked)} />
            Has PDF
          </label>
          <div className="ref-toolbar-spacer" />
          <input className="ref-search" placeholder="Search by title..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {papersError && (
          <EmptyState
            variant="error"
            title="Couldn't load papers"
            action={{ label: 'Retry', onClick: refreshPapers }}
          />
        )}
        {!papersError && papers.length === 0 && (
          <EmptyState title="No papers yet" description='Use "Add Papers" to get started.' />
        )}

        {papers.map((p) => {
          const link = paperSourceLink(p)
          return (
          <div key={p.id} className="paper-row">
            <input type="checkbox" style={{ marginTop: 3 }} readOnly checked={false} />
            <div className="paper-row-main">
              {link ? (
                <a
                  className="paper-row-title paper-row-title-link"
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  title={link.label}
                >
                  {p.title}
                  <span className="paper-row-title-icon">
                    <link.icon size={11} />
                  </span>
                </a>
              ) : (
                <div className="paper-row-title">{p.title}</div>
              )}
              <div className="paper-row-meta">
                {p.type} · {p.year ?? '—'} · {p.authors.slice(0, 3).join(', ')}
                {p.authors.length > 3 ? ` +${p.authors.length - 3} more` : ''}
              </div>
              <div>
                {p.tagIds.map((tid) => {
                  const tag = tags.find((t) => t.id === tid)
                  if (!tag) return null
                  return (
                    <span key={tid} className="tag-chip">
                      <span className="tag-swatch" style={{ background: tag.color }} />
                      {tag.name}
                    </span>
                  )
                })}
                <span className="tag-chip" style={{ cursor: 'pointer' }} onClick={() => setTagMenuFor(tagMenuFor === p.id ? null : p.id)}>
                  + Tag
                </span>
                {tagMenuFor === p.id && (
                  <div className="dropdown-menu" style={{ position: 'static', display: 'inline-block', marginTop: 4 }}>
                    {tags.map((t) => (
                      <label key={t.id} className="dropdown-item" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={p.tagIds.includes(t.id)} onChange={() => handleToggleTag(p, t.id)} />
                        {t.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <span className={`status-badge status-${p.ingestionStatus}`}>
              {p.ingestionStatus === 'ready' ? 'PDF' : p.ingestionStatus === 'no_pdf' ? 'No PDF' : p.ingestionStatus}
            </span>
            <select
              className="btn"
              value={p.folderId ?? ''}
              onChange={(e) => handleMoveToFolder(p.id, e.target.value || null)}
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-icon"
              disabled={p.ingestionStatus !== 'ready'}
              onClick={() => navigate(`/papers/${p.id}/read`)}
              title="Read Paper"
              aria-label="Read Paper"
            >
              <BookOpen size={14} />
            </button>
            <button
              className="btn btn-icon btn-danger-ghost"
              onClick={() => handleDelete(p.id)}
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
          )
        })}
      </div>

      {modal === 'upload-url' && <UploadUrlModal folderId={activeFolderId} onClose={() => setModal(null)} onDone={refreshPapers} />}
      {modal === 'manual' && <AddManualModal folderId={activeFolderId} onClose={() => setModal(null)} onDone={refreshPapers} />}
    </div>
  )
}

function UploadUrlModal({ folderId, onClose, onDone }: { folderId: string | null; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [doi, setDoi] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    try {
      await referencesApi.uploadUrl({ url: url || undefined, doi: doi || undefined, folderId })
      onDone()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Upload URL or DOI
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field-label">DOI</label>
          <input className="text-input" placeholder="10.1234/example" value={doi} onChange={(e) => setDoi(e.target.value)} />
          <label className="field-label">Or a direct PDF URL</label>
          <input className="text-input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={(!url && !doi) || submitting} onClick={submit}>
            {submitting ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddManualModal({ folderId, onClose, onDone }: { folderId: string | null; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [year, setYear] = useState('')
  const [venue, setVenue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!title.trim()) return
    setSubmitting(true)
    try {
      await referencesApi.addManual({
        title: title.trim(),
        authors: authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        year: year ? Number(year) : undefined,
        venue: venue || undefined,
        folderId,
      })
      onDone()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Add Manually
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="field-label">Title</label>
          <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="field-label">Authors (comma separated)</label>
          <input className="text-input" value={authors} onChange={(e) => setAuthors(e.target.value)} />
          <label className="field-label">Year</label>
          <input className="text-input" value={year} onChange={(e) => setYear(e.target.value)} />
          <label className="field-label">Journal / Venue</label>
          <input className="text-input" value={venue} onChange={(e) => setVenue(e.target.value)} />
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!title.trim() || submitting} onClick={submit}>
            {submitting ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
