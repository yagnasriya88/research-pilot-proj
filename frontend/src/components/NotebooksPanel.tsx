import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Highlighter,
  Link as LinkIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Eraser,
  ArrowLeft,
  Trash2,
} from 'lucide-react'
import { notebooksApi } from '../api/notebooks'
import type { NotebookSummary } from '../api/types'
import { EmptyState } from './EmptyState'
import { ConfirmModal } from './ConfirmModal'
import { useToast } from '../toast/ToastContext'

interface Props {
  variant: 'panel' | 'page'
  externalUpdateSignal?: { noteId: string; version: number } | null
}

type SaveStatus = 'idle' | 'saving' | 'saved'

export function NotebooksPanel({ variant, externalUpdateSignal }: Props) {
  const [notes, setNotes] = useState<NotebookSummary[]>([])
  const [search, setSearch] = useState('')
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [activeTitle, setActiveTitle] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const { showToast } = useToast()

  const pendingRef = useRef<{ title?: string; content?: string }>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressRef = useRef(false)
  const activeNoteIdRef = useRef<string | null>(null)

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Markdown,
        Placeholder.configure({ placeholder: 'Start typing your note…' }),
        Underline,
        Highlight,
        Link.configure({ openOnClick: false, autolink: true }),
      ],
      content: '',
      onUpdate: ({ editor: e }) => {
        if (suppressRef.current) return
        queuePatch({ content: e.getMarkdown() })
      },
    },
    [],
  )

  function refreshList() {
    return notebooksApi.list().then(setNotes)
  }

  useEffect(() => {
    refreshList()
  }, [])

  function flush() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const patch = pendingRef.current
    const noteId = activeNoteIdRef.current
    if (!noteId || (patch.title === undefined && patch.content === undefined)) return
    pendingRef.current = {}
    setSaveStatus('saving')
    notebooksApi.update(noteId, patch).then((updated) => {
      setSaveStatus('saved')
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? { ...n, title: updated.title, snippet: updated.content.replace(/\s+/g, ' ').trim().slice(0, 140), updatedAt: updated.updatedAt }
            : n,
        ),
      )
    })
  }

  function queuePatch(partial: { title?: string; content?: string }) {
    pendingRef.current = { ...pendingRef.current, ...partial }
    setSaveStatus('saving')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(flush, 600)
  }

  useEffect(() => {
    return () => flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId
    if (!activeNoteId || !editor) return
    notebooksApi.get(activeNoteId).then((n) => {
      suppressRef.current = true
      setActiveTitle(n.title)
      editor.commands.setContent(n.content || '', { contentType: 'markdown' })
      suppressRef.current = false
      setSaveStatus('idle')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, editor])

  useEffect(() => {
    if (!externalUpdateSignal) return
    if (externalUpdateSignal.noteId === activeNoteId && editor) {
      notebooksApi.get(externalUpdateSignal.noteId).then((n) => {
        suppressRef.current = true
        setActiveTitle(n.title)
        editor.commands.setContent(n.content || '', { contentType: 'markdown' })
        suppressRef.current = false
      })
    }
    refreshList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalUpdateSignal])

  function openNote(id: string) {
    flush()
    setActiveNoteId(id)
  }

  function goBack() {
    flush()
    setActiveNoteId(null)
  }

  function setLink() {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL', previousUrl || '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  async function handleCreate() {
    const created = await notebooksApi.create('Untitled Note')
    await refreshList()
    setActiveNoteId(created.id)
    showToast('Note created')
  }

  async function handleDelete(id: string) {
    await notebooksApi.remove(id)
    if (activeNoteId === id) setActiveNoteId(null)
    showToast('Note deleted')
    refreshList()
  }

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q))
  }, [notes, search])

  const showList = variant === 'page' || activeNoteId === null
  const showEditor = variant === 'page' || activeNoteId !== null

  return (
    <div className={`notes-panel notes-panel--${variant}`}>
      {showList && (
        <div className="notes-list-pane">
          <div className="notes-list-header">
            <input
              className="text-input ref-search"
              style={{ marginBottom: 0 }}
              placeholder="Search notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleCreate}>
              + New
            </button>
          </div>
          {filteredNotes.length === 0 && <EmptyState title="No notes yet" description="Create your first note to get started." />}
          {filteredNotes.map((n) => (
            <div
              key={n.id}
              className={`list-card notes-list-item${activeNoteId === n.id ? ' active' : ''}`}
              onClick={() => openNote(n.id)}
            >
              <div>
                <div className="list-card-title">{n.title}</div>
                <div className="list-card-meta">{n.snippet || 'Empty note'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showEditor &&
        (activeNoteId ? (
          <div className="notes-editor-pane">
            <div className="notes-editor-sticky">
              <div className="notes-editor-header">
                {variant === 'panel' && (
                  <button className="btn btn-icon btn-icon-sm" onClick={goBack} aria-label="Back">
                    <ArrowLeft size={14} />
                  </button>
                )}
                <input
                  className="notes-title-input"
                  value={activeTitle}
                  onChange={(e) => {
                    setActiveTitle(e.target.value)
                    queuePatch({ title: e.target.value })
                  }}
                  placeholder="Untitled Note"
                />
                <span className="notes-save-status">
                  {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : ''}
                </span>
                <button
                  className="btn btn-icon btn-icon-sm btn-danger-ghost"
                  title="Delete note"
                  aria-label="Delete note"
                  onClick={() => setDeleteTargetId(activeNoteId)}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {editor && (
                <div className="notes-toolbar">
                <button
                  className={`btn btn-icon${editor.isActive('bold') ? ' active' : ''}`}
                  title="Bold"
                  onClick={() => editor.chain().focus().toggleBold().run()}
                >
                  <Bold size={18} />
                </button>
                <button
                  className={`btn btn-icon${editor.isActive('italic') ? ' active' : ''}`}
                  title="Italic"
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                >
                  <Italic size={18} />
                </button>
                <button
                  className={`btn btn-icon${editor.isActive('underline') ? ' active' : ''}`}
                  title="Underline"
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                >
                  <UnderlineIcon size={18} />
                </button>
                <button
                  className={`btn btn-icon${editor.isActive('highlight') ? ' active' : ''}`}
                  title="Highlight"
                  onClick={() => editor.chain().focus().toggleHighlight().run()}
                >
                  <Highlighter size={18} />
                </button>
                <span className="notes-toolbar-divider" />
                <button
                  className={`btn btn-icon${editor.isActive('heading', { level: 2 }) ? ' active' : ''}`}
                  title="Heading 2"
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                >
                  <Heading2 size={18} />
                </button>
                <button
                  className={`btn btn-icon${editor.isActive('heading', { level: 3 }) ? ' active' : ''}`}
                  title="Heading 3"
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                >
                  <Heading3 size={18} />
                </button>
                <span className="notes-toolbar-divider" />
                <button
                  className={`btn btn-icon${editor.isActive('bulletList') ? ' active' : ''}`}
                  title="Bullet list"
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  <List size={18} />
                </button>
                <button
                  className={`btn btn-icon${editor.isActive('orderedList') ? ' active' : ''}`}
                  title="Numbered list"
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  <ListOrdered size={18} />
                </button>
                <button
                  className={`btn btn-icon${editor.isActive('blockquote') ? ' active' : ''}`}
                  title="Quote"
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                >
                  <Quote size={18} />
                </button>
                <span className="notes-toolbar-divider" />
                <button
                  className={`btn btn-icon${editor.isActive('link') ? ' active' : ''}`}
                  title="Link"
                  onClick={setLink}
                >
                  <LinkIcon size={18} />
                </button>
                <button
                  className="btn btn-icon"
                  title="Clear formatting"
                  onClick={() => editor.chain().focus().unsetAllMarks().run()}
                >
                  <Eraser size={18} />
                </button>
              </div>
            )}
            </div>

            <div className="notes-editor-content">
              <EditorContent editor={editor} />
            </div>
          </div>
        ) : (
          <div style={{ margin: 'auto' }}>
            <EmptyState title="No note selected" description="Select a note or create a new one." />
          </div>
        ))}

      {deleteTargetId && (
        <ConfirmModal
          title="Delete this note?"
          description="This note will be permanently deleted. This can't be undone."
          confirmLabel="Delete"
          onClose={() => setDeleteTargetId(null)}
          onConfirm={() => handleDelete(deleteTargetId)}
        />
      )}
    </div>
  )
}
