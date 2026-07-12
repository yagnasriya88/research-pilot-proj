import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, MessageCircle, PanelRight, PanelLeft } from 'lucide-react'
import { referencesApi } from '../api/references'
import { booksApi } from '../api/books'
import { highlightsApi, bookHighlightsApi } from '../api/highlights'
import { chatsApi } from '../api/chats'
import type { ExcerptRef, ImageExcerptRef, Highlight, Paper, Book } from '../api/types'
import { PdfViewer, type PdfViewerHandle } from '../components/PdfViewer'
import { ChatPanel } from '../components/ChatPanel'
import { BookTocPanel } from '../components/BookTocPanel'

export function ReaderPage({ sourceType }: { sourceType: 'paper' | 'book' }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [paper, setPaper] = useState<Paper | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [askAiExcerpt, setAskAiExcerpt] = useState<ExcerptRef | null>(null)
  const [askAiImageExcerpt, setAskAiImageExcerpt] = useState<ImageExcerptRef | null>(null)
  const [chatPaneOpen, setChatPaneOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [tocCollapsed, setTocCollapsed] = useState(false)
  const pdfViewerRef = useRef<PdfViewerHandle>(null)

  const source = sourceType === 'book' ? book : paper
  const backTarget = sourceType === 'book' ? '/my-books' : '/references'

  useEffect(() => {
    if (!id) return
    if (sourceType === 'book') {
      booksApi.get(id).then(setBook)
      bookHighlightsApi.list(id).then(setHighlights)
      chatsApi.getForBook(id).then((c) => setChatId(c.id))
    } else {
      referencesApi.getPaper(id).then(setPaper)
      highlightsApi.list(id).then(setHighlights)
      chatsApi.getForPaper(id).then((c) => setChatId(c.id))
    }
  }, [id, sourceType])

  async function handleHighlight(h: { page: number; color: Highlight['color']; rects: Highlight['rects']; quote: string }) {
    if (!id) return
    const created = sourceType === 'book' ? await bookHighlightsApi.create(id, h) : await highlightsApi.create(id, h)
    setHighlights((prev) => [...prev, created])
  }

  function handleAskAi(excerpt: { quote: string; page: number }) {
    if (!id) return
    setAskAiImageExcerpt(null)
    setAskAiExcerpt(sourceType === 'book' ? excerpt : { paperId: id, ...excerpt })
  }

  function handleImageAskAi(excerpt: { imageDataUrl: string; page: number }) {
    setAskAiExcerpt(null)
    const [, base64] = excerpt.imageDataUrl.split(',')
    setAskAiImageExcerpt({ page: excerpt.page, imageBase64: base64 })
  }

  if (!id) return <div className="empty-state" style={{ margin: 40 }}>Loading...</div>

  return (
    <div className="reader-page">
      <div className="chat-breadcrumb">
        <span className="reader-paper-title">
          <BookOpen size={17} /> {source ? source.title : 'Loading...'}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {sourceType === 'book' && book && book.tableOfContents.length > 0 && (
            <button
              type="button"
              className="btn btn-icon btn-icon-sm book-toc-toggle"
              onClick={() => {
                setTocOpen(true)
                setTocCollapsed(false)
              }}
              aria-label="Open table of contents"
            >
              <PanelLeft size={15} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon btn-icon-sm chat-side-panel-toggle"
            onClick={() => setChatPaneOpen(true)}
            aria-label="Open chat panel"
          >
            <PanelRight size={15} />
          </button>
          <button className="btn" onClick={() => navigate(backTarget)}>
            {sourceType === 'book' ? 'Back to My Books' : 'Back to References'}
          </button>
        </div>
      </div>

      <div className="reader-body">
        {sourceType === 'book' && book && book.tableOfContents.length > 0 && (
          <>
            {tocOpen && <div className="drawer-scrim" onClick={() => setTocOpen(false)} />}
            <div className={`book-toc-pane${tocOpen ? ' open' : ''}${tocCollapsed ? ' collapsed' : ''}`}>
              <BookTocPanel
                tableOfContents={book.tableOfContents}
                currentPage={page}
                onNavigate={(target) => {
                  pdfViewerRef.current?.scrollToPage(target)
                  setTocOpen(false)
                }}
                onCollapse={() => {
                  setTocCollapsed(true)
                  setTocOpen(false)
                }}
              />
            </div>
          </>
        )}

        <PdfViewer
          ref={pdfViewerRef}
          sourceId={id}
          sourceType={sourceType}
          page={page}
          onPageChange={setPage}
          existingHighlights={highlights}
          onHighlight={handleHighlight}
          onAskAi={handleAskAi}
          onImageAskAi={handleImageAskAi}
        />

        {chatPaneOpen && <div className="drawer-scrim" onClick={() => setChatPaneOpen(false)} />}
        <div className={`reader-chat-pane${chatPaneOpen ? ' open' : ''}`}>
          <div className="reader-chat-header">
            <MessageCircle size={15} /> Chat
          </div>
          {chatId ? (
            <ChatPanel chatId={chatId} askAiExcerpt={askAiExcerpt} askAiImageExcerpt={askAiImageExcerpt} />
          ) : (
            <div className="empty-state" style={{ margin: 40 }}>Loading...</div>
          )}
        </div>
      </div>
    </div>
  )
}
