import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  NotebookPen,
  ArrowLeft,
  FileText,
  Folder as FolderIcon,
  BookOpen,
  Download,
  MessageCircle,
  Check,
  PanelRight,
} from 'lucide-react'
import { chatsApi } from '../api/chats'
import { referencesApi } from '../api/references'
import type { Chat, MessageOutput } from '../api/types'
import { ReferencePickerModal, type ReferencePickerSelection } from '../components/ReferencePickerModal'
import { Markdown } from '../components/Markdown'
import { NotebooksPanel } from '../components/NotebooksPanel'
import { SaveToFolderModal } from '../components/SaveToFolderModal'
import { ChatPanel } from '../components/ChatPanel'
import { EmptyState } from '../components/EmptyState'
import { useToast } from '../toast/ToastContext'

const TYPE_LABEL: Record<Chat['type'], string> = {
  chat_with_pdf: 'Chat with PDF',
  chat_with_book: 'Chat with Book',
  search: 'AI Search',
  deep_research: 'Deep Research Report',
}

export function ChatThread() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [chat, setChat] = useState<Chat | null>(null)
  const [liveOutput, setLiveOutput] = useState<MessageOutput | null>(null)
  const [showAddSource, setShowAddSource] = useState(false)
  const [reloadSignal, setReloadSignal] = useState(0)
  const [selectedOutputIdx, setSelectedOutputIdx] = useState<number | null>(null)
  const [showNotesPanel, setShowNotesPanel] = useState(false)
  const [noteUpdateSignal, setNoteUpdateSignal] = useState<{ noteId: string; version: number } | null>(null)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)

  const [initialMessage] = useState<string | undefined>(
    () => (location.state as { initialMessage?: string } | null)?.initialMessage,
  )
  useEffect(() => {
    if (initialMessage) navigate(location.pathname, { replace: true, state: {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleChatChange(c: Chat) {
    setChat(c)
    setSelectedOutputIdx(null)
  }

  const outputs = useMemo(() => {
    if (!chat) return []
    return chat.messages
      .map((m, idx) => ({ idx, message: m }))
      .filter((x) => x.message.output)
      .map((x, i) => ({
        index: i,
        messageIdx: x.idx,
        label: chat.messages[x.idx - 1]?.content?.slice(0, 60) || `Output ${i + 1}`,
        output: x.message.output as MessageOutput,
      }))
  }, [chat])

  const activeOutput = liveOutput ?? (selectedOutputIdx !== null ? outputs[selectedOutputIdx]?.output : outputs.at(-1)?.output) ?? null

  async function handleAddSources(selection: ReferencePickerSelection) {
    if (!chatId) return
    for (const folderId of selection.folderIds) {
      await chatsApi.addSource(chatId, { folderId })
    }
    for (const paperId of selection.paperIds) {
      await chatsApi.addSource(chatId, { paperId })
    }
    setShowAddSource(false)
    setReloadSignal((v) => v + 1)
  }

  function downloadMarkdown(markdown: string, filename: string) {
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!chatId) return <div className="empty-state" style={{ margin: 40 }}>Loading...</div>

  return (
    <div className="chat-page">
      <div className="chat-breadcrumb">
        <span>{chat ? `${TYPE_LABEL[chat.type]} / ${chat.title}` : 'Loading...'}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {outputs.length > 0 && (
            <select
              className="btn"
              value={selectedOutputIdx ?? outputs.length - 1}
              onChange={(e) => setSelectedOutputIdx(Number(e.target.value))}
            >
              {outputs.map((o) => (
                <option key={o.index} value={o.index}>
                  Output {o.index + 1}: {o.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => setShowNotesPanel((v) => !v)}>
            {showNotesPanel ? (
              <>
                <ArrowLeft size={14} /> Back
              </>
            ) : (
              <>
                <NotebookPen size={14} /> Notes
              </>
            )}
          </button>
          <button
            type="button"
            className="btn btn-icon btn-icon-sm chat-side-panel-toggle"
            onClick={() => setSidePanelOpen(true)}
            aria-label="Open sources panel"
          >
            <PanelRight size={15} />
          </button>
          <button className="btn" onClick={() => navigate('/')}>
            + New Chat
          </button>
        </div>
      </div>

      <div className="chat-body">
        <ChatPanel
          chatId={chatId}
          reloadSignal={reloadSignal}
          initialMessage={initialMessage}
          onChatChange={handleChatChange}
          onOutput={setLiveOutput}
          onNoteSaved={(noteId, mode) => {
            if (mode === 'append') setNoteUpdateSignal({ noteId, version: Date.now() })
          }}
        />

        {sidePanelOpen && <div className="drawer-scrim" onClick={() => setSidePanelOpen(false)} />}
        <div className={`chat-side-panel${sidePanelOpen ? ' open' : ''}`}>
          {showNotesPanel ? (
            <NotebooksPanel variant="panel" externalUpdateSignal={noteUpdateSignal} />
          ) : (
            <>
              {chat?.type === 'chat_with_pdf' && (
                <div className="chat-sources">
                  <div className="chat-sources-header">
                    <span>
                      Sources ({chat.sources.folders.length + chat.sources.papers.length})
                    </span>
                    <button className="btn" onClick={() => setShowAddSource(true)}>
                      + Add File
                    </button>
                  </div>
                  {chat.sources.folders.length === 0 && chat.sources.papers.length === 1 ? (
                    <>
                      <div className="source-card">
                        <div className="source-card-title">
                          <FileText size={13} /> {chat.sources.papers[0].title}
                        </div>
                      </div>
                      <button
                        className="btn"
                        style={{ width: '100%' }}
                        onClick={() => navigate(`/papers/${chat.sources.papers[0].id}/read`)}
                      >
                        <BookOpen size={14} /> Open Reader
                      </button>
                    </>
                  ) : (
                    <>
                      {chat.sources.folders.map((f) => (
                        <div key={f.id} className="source-card">
                          <div className="source-card-title">
                            <FolderIcon size={13} /> {f.name}
                          </div>
                          <div className="source-card-meta">{f.paperCount} paper(s) — whole folder</div>
                        </div>
                      ))}
                      {chat.sources.papers.map((p) => (
                        <div key={p.id} className="source-card">
                          <div className="source-card-title">
                            <FileText size={13} /> {p.title}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {chat?.type === 'chat_with_book' && chat.sources.book && (
                <div className="chat-sources">
                  <div className="chat-sources-header">
                    <span>Source</span>
                  </div>
                  <div className="source-card">
                    <div className="source-card-title">
                      <BookOpen size={13} /> {chat.sources.book.title}
                    </div>
                  </div>
                  <button className="btn" style={{ width: '100%' }} onClick={() => navigate(`/books/${chat.sources.book!.id}/read`)}>
                    <BookOpen size={14} /> Open Reader
                  </button>
                </div>
              )}

              {(chat?.type === 'search' || chat?.type === 'deep_research') && (
                <OutputPanel output={activeOutput} onDownload={downloadMarkdown} onSaved={() => setReloadSignal((v) => v + 1)} />
              )}
            </>
          )}
        </div>
      </div>

      {showAddSource && chat && (
        <ReferencePickerModal
          title="Add sources to this chat"
          excludePaperIds={chat.sourcePaperIds}
          excludeFolderIds={chat.sourceFolderIds}
          onClose={() => setShowAddSource(false)}
          onConfirm={handleAddSources}
        />
      )}
    </div>
  )
}

function OutputPanel({
  output,
  onDownload,
  onSaved,
}: {
  output: MessageOutput | null
  onDownload: (markdown: string, filename: string) => void
  onSaved: () => void
}) {
  if (!output) {
    return (
      <div className="chat-sources">
        <EmptyState title="No output yet" description="Ask a question to get started." />
      </div>
    )
  }

  if (output.kind === 'papers') {
    return (
      <div className="chat-sources chat-sources--wide">
        <div className="chat-sources-header">
          <span>Papers ({output.results.length})</span>
        </div>
        {output.results.map((r, i) => (
          <SearchResultCard key={i} rank={i + 1} result={r} onSaved={onSaved} />
        ))}
      </div>
    )
  }

  return (
    <div className="chat-sources chat-sources--wide">
      <div className="chat-sources-header">
        <span>Report</span>
        <button className="btn" onClick={() => onDownload(output.markdown, 'deep-research-report.md')}>
          <Download size={13} /> Download .md
        </button>
      </div>
      <Markdown>{output.markdown}</Markdown>
    </div>
  )
}

function SearchResultCard({
  rank,
  result,
  onSaved,
}: {
  rank: number
  result: import('../api/types').SearchResult
  onSaved: () => void
}) {
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const navigate = useNavigate()
  const { showToast } = useToast()

  async function save(folderId?: string | null) {
    setSaving(true)
    try {
      const paper = await referencesApi.saveFromSearch({
        title: result.title,
        authors: result.authors,
        year: result.year,
        venue: result.venue,
        doi: result.doi,
        abstract: result.abstract,
        citationCount: result.citationCount,
        url: result.url,
        pdfUrl: result.pdfUrl,
        folderId,
      })
      setSaved(true)
      onSaved()
      return paper
    } finally {
      setSaving(false)
    }
  }

  async function saveToFolder(folderId: string | null) {
    await save(folderId)
    setShowFolderModal(false)
    showToast('Saved to References')
  }

  async function saveAndChat() {
    const paper = await save()
    if (!paper) return
    const chat = await chatsApi.create({ type: 'chat_with_pdf', sourcePaperIds: [paper.id] })
    navigate(`/chats/${chat.id}`)
  }

  return (
    <div className="source-card">
      <div className="source-card-meta">
        {rank}. {result.venue || result.source}
      </div>
      <div className="source-card-title">{result.title}</div>
      <div className="source-card-meta">
        {result.citationCount ?? 0} Citations · {result.year ?? 'n.d.'} · {result.authors.slice(0, 2).join(', ')}
        {result.authors.length > 2 ? ` +${result.authors.length - 2} more` : ''}
      </div>
      {result.abstract && (
        <div className="search-result-abstract">{result.abstract.slice(0, 220)}...</div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn" disabled={saving || saved} onClick={() => setShowFolderModal(true)}>
          {saved ? (
            <>
              <Check size={13} /> Saved
            </>
          ) : (
            '+ My References'
          )}
        </button>
        <button className="btn" disabled={saving} onClick={saveAndChat}>
          <MessageCircle size={13} /> Save & Chat
        </button>
        {result.pdfUrl && (
          <a className="btn" href={result.pdfUrl} target="_blank" rel="noreferrer">
            <FileText size={13} /> PDF
          </a>
        )}
      </div>
      {showFolderModal && (
        <SaveToFolderModal onClose={() => setShowFolderModal(false)} onConfirm={saveToFolder} />
      )}
    </div>
  )
}
