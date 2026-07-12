import { useEffect, useState } from 'react'
import { Folder as FolderIcon, X } from 'lucide-react'
import { referencesApi } from '../api/references'
import type { Folder } from '../api/types'

interface Props {
  onClose: () => void
  onConfirm: (folderId: string | null) => void | Promise<void>
}

export function SaveToFolderModal({ onClose, onConfirm }: Props) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    referencesApi.listFolders().then(setFolders).catch(() => setFolders([]))
  }, [])

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    const folder = await referencesApi.createFolder(newFolderName.trim())
    setFolders((prev) => [...prev, folder])
    setSelectedFolderId(folder.id)
    setNewFolderName('')
    setShowNewFolder(false)
  }

  async function handleAdd() {
    setSaving(true)
    try {
      await onConfirm(selectedFolderId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Select folder to add to References
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <label className="ref-tree-item" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <input type="radio" checked={selectedFolderId === null} onChange={() => setSelectedFolderId(null)} />
            Unorganised
          </label>
          {folders.map((f) => (
            <label key={f.id} className="ref-tree-item" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <input
                type="radio"
                checked={selectedFolderId === f.id}
                onChange={() => setSelectedFolderId(f.id)}
              />
              <FolderIcon size={13} /> {f.name}
            </label>
          ))}

          {showNewFolder ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                className="text-input"
                style={{ flex: 1, marginBottom: 0 }}
                autoFocus
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              />
              <button className="btn" onClick={handleCreateFolder}>
                Create
              </button>
            </div>
          ) : (
            <button className="btn" style={{ marginTop: 8 }} onClick={() => setShowNewFolder(true)}>
              + New Folder
            </button>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={handleAdd}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
