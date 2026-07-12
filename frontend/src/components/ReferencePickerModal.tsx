import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { referencesApi } from '../api/references'
import type { Folder, Paper } from '../api/types'
import { EmptyState } from './EmptyState'

export interface ReferencePickerSelection {
  folderIds: string[]
  paperIds: string[]
}

interface Props {
  title?: string
  excludePaperIds?: string[]
  excludeFolderIds?: string[]
  initialSelection?: ReferencePickerSelection
  /** Restrict to picking exactly one folder as a whole (no individual papers) — used by Deep Research. */
  singleFolder?: boolean
  onClose: () => void
  onConfirm: (selection: ReferencePickerSelection) => void
}

export function ReferencePickerModal({
  title = 'Select papers from Reference Manager',
  excludePaperIds = [],
  excludeFolderIds = [],
  initialSelection,
  singleFolder = false,
  onClose,
  onConfirm,
}: Props) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [papers, setPapers] = useState<Paper[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(
    () => new Set(initialSelection?.folderIds ?? []),
  )
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(
    () => new Set(initialSelection?.paperIds ?? []),
  )
  const [loading, setLoading] = useState(false)
  const [foldersError, setFoldersError] = useState(false)
  const [papersError, setPapersError] = useState(false)
  const [foldersReloadKey, setFoldersReloadKey] = useState(0)
  const [papersReloadKey, setPapersReloadKey] = useState(0)

  useEffect(() => {
    setFoldersError(false)
    referencesApi
      .listFolders()
      .then(setFolders)
      .catch(() => {
        setFolders([])
        setFoldersError(true)
      })
  }, [foldersReloadKey])

  useEffect(() => {
    setLoading(true)
    setPapersError(false)
    referencesApi
      .listPapers({ folderId: activeFolderId ?? undefined, search: search || undefined })
      .then(setPapers)
      .catch(() => {
        setPapers([])
        setPapersError(true)
      })
      .finally(() => setLoading(false))
  }, [activeFolderId, search, papersReloadKey])

  const visiblePapers = useMemo(() => papers.filter((p) => !excludePaperIds.includes(p.id)), [papers, excludePaperIds])
  const visibleFolders = useMemo(() => folders.filter((f) => !excludeFolderIds.includes(f.id)), [folders, excludeFolderIds])

  function togglePaper(id: string) {
    setSelectedPaperIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleFolder(id: string) {
    if (singleFolder) {
      setSelectedFolderIds((prev) => (prev.has(id) ? new Set() : new Set([id])))
      return
    }
    setSelectedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalSelected = singleFolder ? selectedFolderIds.size : selectedFolderIds.size + selectedPaperIds.size

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {title}
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body ref-picker-body">
          <div className="ref-picker-sidebar">
            {foldersError ? (
              <EmptyState
                variant="error"
                title="Couldn't load folders"
                action={{ label: 'Retry', onClick: () => setFoldersReloadKey((k) => k + 1) }}
              />
            ) : (
              <>
                <div
                  className={`ref-tree-item${activeFolderId === null ? ' active' : ''}`}
                  onClick={() => setActiveFolderId(null)}
                >
                  All Papers
                </div>
                {visibleFolders.map((f) => (
                  <div key={f.id} className={`ref-tree-item${activeFolderId === f.id ? ' active' : ''}`}>
                    <label className="ref-picker-folder-label">
                      <input
                        type={singleFolder ? 'radio' : 'checkbox'}
                        checked={selectedFolderIds.has(f.id)}
                        onChange={() => toggleFolder(f.id)}
                      />
                      <span onClick={() => setActiveFolderId(f.id)} className="ref-picker-folder-name">
                        {f.name}
                      </span>
                    </label>
                  </div>
                ))}
              </>
            )}
            <div className="ref-picker-footnote">
              {singleFolder
                ? 'Pick one folder — its entire contents (resolved live) will be used as the research scope.'
                : 'Check a folder to use its entire contents as a source. Click the name to browse and pick individual papers instead.'}
            </div>
          </div>
          <div className="ref-picker-main">
            <input
              className="ref-search"
              style={{ width: '100%', marginBottom: 8 }}
              placeholder="Search references..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {papersError ? (
              <EmptyState
                variant="error"
                title="Couldn't load papers"
                action={{ label: 'Retry', onClick: () => setPapersReloadKey((k) => k + 1) }}
              />
            ) : loading ? (
              <EmptyState title="Loading papers…" />
            ) : visiblePapers.length === 0 ? (
              <EmptyState title="No papers found" />
            ) : (
              visiblePapers.map((p) => (
                <label key={p.id} className="checkbox-row" style={singleFolder ? { cursor: 'default' } : undefined}>
                  {singleFolder ? (
                    <span className="ref-picker-bullet">·</span>
                  ) : (
                    <input type="checkbox" checked={selectedPaperIds.has(p.id)} onChange={() => togglePaper(p.id)} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div className="paper-row-title">
                      {p.title} {p.ingestionStatus === 'ready' && <span className="status-badge status-ready">PDF</span>}
                    </div>
                    <div className="paper-row-meta">
                      {p.type} · {p.year ?? '—'} · {p.authors.slice(0, 2).join(', ')}
                      {p.authors.length > 2 ? ` +${p.authors.length - 2} more` : ''}
                    </div>
                  </div>
                </label>
              ))
            )}
            {singleFolder && (
              <div className="ref-picker-footnote">
                Browsing preview only — papers here aren't individually selectable for Deep Research; pick the whole
                folder on the left.
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {singleFolder
              ? `${selectedFolderIds.size} folder selected`
              : `${selectedFolderIds.size} folder(s), ${selectedPaperIds.size} paper(s) selected`}
          </span>
          <button
            className="btn btn-primary"
            disabled={totalSelected === 0}
            onClick={() =>
              onConfirm({ folderIds: Array.from(selectedFolderIds), paperIds: Array.from(selectedPaperIds) })
            }
          >
            Continue
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
