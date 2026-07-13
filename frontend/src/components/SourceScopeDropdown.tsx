import { useEffect, useState } from 'react'
import { Folder as FolderIcon, Library, Package, X, ChevronDown } from 'lucide-react'
import { referencesApi } from '../api/references'
import type { ChatType, Folder } from '../api/types'
import { ReferencePickerModal, type ReferencePickerSelection } from './ReferencePickerModal'

export type SourceScopeValue =
  | { kind: 'all_papers' }
  | { kind: 'arxiv' }
  | { kind: 'reference_manager'; folderIds: string[]; paperIds: string[] }

interface Props {
  agent: ChatType
  value: SourceScopeValue
  onChange: (value: SourceScopeValue) => void
}

export function SourceScopeDropdown({ agent, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])

  useEffect(() => {
    referencesApi.listFolders().then(setFolders).catch(() => setFolders([]))
  }, [])

  // Chat with PDF can only ever work over already-ingested papers — no external database choice.
  const showDatabases = agent !== 'chat_with_pdf'
  // Deep Research (Standard mode) only accepts a single whole folder as its scope (backend constraint).
  const singleFolder = agent === 'deep_research'

  function referenceLabel(): string {
    if (value.kind !== 'reference_manager') return singleFolder ? 'Choose Folder' : 'Choose References'
    if (singleFolder) {
      const folder = folders.find((f) => f.id === value.folderIds[0])
      return folder ? folder.name : 'Choose Folder'
    }
    const count = value.folderIds.length + value.paperIds.length
    return count > 0 ? `${count} reference(s)` : 'Choose References'
  }

  const triggerLabel =
    value.kind === 'all_papers' ? 'All Papers' : value.kind === 'arxiv' ? 'ArXiv' : referenceLabel()
  const TriggerIcon = value.kind === 'reference_manager' ? FolderIcon : Library

  function handlePickerConfirm(sel: ReferencePickerSelection) {
    onChange({ kind: 'reference_manager', folderIds: sel.folderIds, paperIds: sel.paperIds })
    setShowPicker(false)
  }

  return (
    <>
      <div className="dropdown">
        <button className="btn btn-pill" onClick={() => setOpen((v) => !v)}>
          <TriggerIcon size={14} /> {triggerLabel}
          <ChevronDown size={14} />
        </button>
        {value.kind === 'reference_manager' && (value.folderIds.length > 0 || value.paperIds.length > 0) && (
          <button
            className="btn btn-icon btn-icon-sm"
            title="Clear selection"
            aria-label="Clear selection"
            style={{ marginLeft: 4 }}
            onClick={() => onChange({ kind: 'all_papers' })}
          >
            <X size={12} />
          </button>
        )}
        {open && (
          <div className="dropdown-menu">
            {showDatabases && (
              <>
                <div className="dropdown-section-label">Research Databases:</div>
                <div
                  className={`dropdown-item${value.kind === 'all_papers' ? ' selected' : ''}`}
                  onClick={() => {
                    onChange({ kind: 'all_papers' })
                    setOpen(false)
                  }}
                >
                  <span className="dropdown-item-label">
                    <Library size={14} /> All Papers
                  </span>
                  <span className="dropdown-item-sub">Search Semantic Scholar + arXiv</span>
                </div>
                <div
                  className={`dropdown-item${value.kind === 'arxiv' ? ' selected' : ''}`}
                  onClick={() => {
                    onChange({ kind: 'arxiv' })
                    setOpen(false)
                  }}
                >
                  <span className="dropdown-item-label">
                    <Package size={14} /> ArXiv
                  </span>
                  <span className="dropdown-item-sub">
                    Explore research preprints from arXiv — strongest for CS, physics, math &amp;
                    quantitative biology
                  </span>
                </div>
              </>
            )}
            <div className="dropdown-section-label">My References:</div>
            <div
              className={`dropdown-item${value.kind === 'reference_manager' ? ' selected' : ''}`}
              onClick={() => {
                setShowPicker(true)
                setOpen(false)
              }}
            >
              <span className="dropdown-item-label">
                <FolderIcon size={14} /> Reference Manager
              </span>
              <span className="dropdown-item-sub">
                {singleFolder ? 'Pick one folder from your saved papers' : 'Papers you’ve saved in Reference Manager'}
              </span>
            </div>
          </div>
        )}
      </div>

      {showPicker && (
        <ReferencePickerModal
          title={singleFolder ? 'Choose a folder to research' : 'Choose references to research'}
          singleFolder={singleFolder}
          initialSelection={
            value.kind === 'reference_manager'
              ? { folderIds: value.folderIds, paperIds: value.paperIds }
              : { folderIds: [], paperIds: [] }
          }
          onClose={() => setShowPicker(false)}
          onConfirm={handlePickerConfirm}
        />
      )}
    </>
  )
}
