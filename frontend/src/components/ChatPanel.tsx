import { useEffect, useRef, useState } from 'react'
import { NotebookPen, Check, X, ArrowUp } from 'lucide-react'
import { chatsApi } from '../api/chats'
import { API_ORIGIN } from '../api/client'
import type { Chat, ChatMessage, DeepResearchStage, ExcerptRef, ImageExcerptRef, MessageOutput } from '../api/types'
import { Markdown } from '../components/Markdown'
import { SaveToNotebookModal } from '../components/SaveToNotebookModal'
import { useToast } from '../toast/ToastContext'

// A message's `imageExcerpt.imagePath` is either a live capture's own data URL (an
// optimistic, not-yet-persisted local message) or a server-relative disk path already
// persisted to Mongo (never raw base64, to avoid bloating chat documents) — resolve
// either shape to something an <img> can load directly.
function resolveImageUrl(imagePath: string): string {
  if (imagePath.startsWith('data:')) return imagePath
  const filename = imagePath.split(/[\\/]/).pop()
  return `${API_ORIGIN}/api/chat-images/${filename}`
}

const QUICK_ACTIONS = [
  'Summarize the paper(s)',
  'Compare key claims across papers',
  'Find evidence for a claim',
  'Extract the study population',
  'Get a brief overview of the topic',
  'Extract numbers & metrics',
]

const STAGE_LABEL: Record<string, string> = {
  plan: 'Planning research angles',
  search: 'Searching for papers',
  screen: 'Screening candidates',
  extract: 'Extracting findings',
  synthesize: 'Writing report',
  planning: 'Expanding your question',
  research: 'Researching',
}

export function ChatPanel({
  chatId,
  reloadSignal,
  initialMessage,
  askAiExcerpt,
  askAiImageExcerpt,
  onChatChange,
  onOutput,
  onNoteSaved,
}: {
  chatId: string
  reloadSignal?: number
  initialMessage?: string
  askAiExcerpt?: ExcerptRef | null
  askAiImageExcerpt?: ImageExcerptRef | null
  onChatChange?: (chat: Chat) => void
  onOutput?: (output: MessageOutput | null) => void
  onNoteSaved?: (noteId: string, mode: 'append' | 'create') => void
}) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [liveStages, setLiveStages] = useState<DeepResearchStage[] | null>(null)
  const [pending, setPending] = useState(false)
  const [saveTarget, setSaveTarget] = useState<{ messageIdx: number; text: string } | null>(null)
  const [savedMessageIdx, setSavedMessageIdx] = useState<number | null>(null)
  const [pendingExcerpt, setPendingExcerpt] = useState<ExcerptRef | null>(null)
  const [pendingImageExcerpt, setPendingImageExcerpt] = useState<ImageExcerptRef | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sentInitialRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { showToast } = useToast()

  function load() {
    chatsApi.get(chatId).then((c) => {
      setChat(c)
      onChatChange?.(c)
    })
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [chatId, reloadSignal])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat?.messages, streamingText, liveStages])

  function send(content: string, excerpt?: ExcerptRef, imageExcerpt?: ImageExcerptRef) {
    if (!content.trim() || pending) return
    setPending(true)
    setInput('')
    setChat((prev) =>
      prev
        ? {
            ...prev,
            messages: [
              ...prev.messages,
              {
                role: 'user',
                content,
                createdAt: new Date().toISOString(),
                excerpt,
                imageExcerpt: imageExcerpt
                  ? { page: imageExcerpt.page, imagePath: `data:image/png;base64,${imageExcerpt.imageBase64}` }
                  : undefined,
              },
            ],
          }
        : prev,
    )
    setStreamingText('')
    onOutput?.(null)
    setLiveStages(
      chat?.type === 'deep_research' && chat.messages.length === 0
        ? chat.deepResearchMode === 'openai'
          ? [
              { name: 'planning', status: 'pending' },
              { name: 'research', status: 'pending' },
            ]
          : [
              { name: 'plan', status: 'pending' },
              { name: 'search', status: 'pending' },
              { name: 'screen', status: 'pending' },
              { name: 'extract', status: 'pending' },
              { name: 'synthesize', status: 'pending' },
            ]
        : null,
    )

    chatsApi.streamMessage(
      chatId,
      content,
      {
        onOutput: (output) => onOutput?.(output),
        onStage: ({ stage, status, detail }) => {
          setLiveStages((prev) => {
            const list = prev ?? []
            const existing = list.find((s) => s.name === stage)
            if (!existing) {
              return [...list, { name: stage, status: status as DeepResearchStage['status'], detail }]
            }
            return list.map((s) => (s.name === stage ? { ...s, status: status as DeepResearchStage['status'], detail } : s))
          })
        },
        onDelta: (delta) => setStreamingText((prev) => (prev ?? '') + delta),
        onDone: () => {
          setStreamingText(null)
          setLiveStages(null)
          setPending(false)
          load()
        },
        onError: () => {
          setStreamingText(null)
          setLiveStages(null)
          setPending(false)
        },
      },
      excerpt,
      imageExcerpt,
    )
  }

  useEffect(() => {
    if (initialMessage && chat && chat.messages.length === 0 && !sentInitialRef.current) {
      sentInitialRef.current = true
      send(initialMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat])

  useEffect(() => {
    if (askAiExcerpt) {
      setPendingImageExcerpt(null)
      setPendingExcerpt(askAiExcerpt)
      setInput('Explain this passage.')
      requestAnimationFrame(() => inputRef.current?.select())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askAiExcerpt])

  useEffect(() => {
    if (askAiImageExcerpt) {
      setPendingExcerpt(null)
      setPendingImageExcerpt(askAiImageExcerpt)
      setInput('Explain this.')
      requestAnimationFrame(() => inputRef.current?.select())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askAiImageExcerpt])

  function submitComposer() {
    send(input, pendingExcerpt ?? undefined, pendingImageExcerpt ?? undefined)
    setPendingExcerpt(null)
    setPendingImageExcerpt(null)
  }

  if (!chat) return <div className="empty-state" style={{ margin: 40 }}>Loading...</div>

  return (
    <div className="chat-thread">
      <div className="chat-messages">
        {chat.messages.length === 0 && !liveStages && (
          <div className="empty-state">
            {chat.type === 'chat_with_pdf' && 'Ask a question about the source paper(s).'}
            {chat.type === 'chat_with_book' && 'Ask a question about this book.'}
            {chat.type === 'search' && 'Ask a research question to search papers.'}
            {chat.type === 'deep_research' && 'Describe the topic for your Deep Research Report.'}
          </div>
        )}
        {chat.messages.map((m: ChatMessage, i: number) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.excerpt && (
              <div className="chat-bubble-excerpt">
                "{m.excerpt.quote}" — p.{m.excerpt.page}
              </div>
            )}
            {m.imageExcerpt && (
              <div className="chat-bubble-image-excerpt">
                <img src={resolveImageUrl(m.imageExcerpt.imagePath)} alt={`Selected region, p.${m.imageExcerpt.page}`} />
                <span>p.{m.imageExcerpt.page}</span>
              </div>
            )}
            {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : m.content}
            {m.role === 'assistant' && (
              <div className="chat-bubble-actions">
                <button
                  className="btn btn-pill btn-save-note"
                  onClick={() =>
                    setSaveTarget({
                      messageIdx: i,
                      text: m.output?.kind === 'document' ? m.output.markdown : m.content,
                    })
                  }
                >
                  {savedMessageIdx === i ? (
                    <>
                      <Check size={13} /> Saved
                    </>
                  ) : (
                    <>
                      <NotebookPen size={13} /> Save to Notes
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        ))}
        {liveStages && (
          <div className="chat-bubble assistant">
            <div className="dr-stages">
              {liveStages.map((s, idx) => (
                <div key={s.name} className={`dr-stage dr-stage--${s.status}`}>
                  <div className="dr-stage-rail">
                    <span className="dr-stage-icon">{s.status === 'done' && <Check size={9} strokeWidth={3} />}</span>
                    {idx < liveStages.length - 1 && <span className="dr-stage-line" />}
                  </div>
                  <div className="dr-stage-text">
                    <span className="dr-stage-label">{STAGE_LABEL[s.name]}</span>
                    {s.detail && <span className="dr-stage-detail"> — {s.detail}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {streamingText !== null && (
          <div className="chat-bubble assistant">
            {streamingText ? (
              <Markdown>{streamingText}</Markdown>
            ) : (
              <span className="chat-loading-dots">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {chat.type === 'chat_with_pdf' && (
        <div className="quick-actions">
          {QUICK_ACTIONS.map((qa) => (
            <button key={qa} className="btn btn-pill" onClick={() => send(qa)} disabled={pending}>
              {qa}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-bar">
        {pendingExcerpt && (
          <div className="chat-pending-excerpt">
            <span>"{pendingExcerpt.quote}" — p.{pendingExcerpt.page}</span>
            <button title="Remove selected passage" onClick={() => setPendingExcerpt(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        {pendingImageExcerpt && (
          <div className="chat-pending-excerpt chat-pending-image-excerpt">
            <img src={`data:image/png;base64,${pendingImageExcerpt.imageBase64}`} alt="Selected region" />
            <span>Selected region — p.{pendingImageExcerpt.page}</span>
            <button title="Remove selected image" onClick={() => setPendingImageExcerpt(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            placeholder={
              pendingExcerpt || pendingImageExcerpt
                ? 'Ask a question about this passage...'
                : chat.type === 'search'
                  ? 'Ask another research question...'
                  : 'Ask a follow-up...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitComposer()
              }
            }}
          />
          <button
            className="btn btn-primary btn-icon"
            onClick={submitComposer}
            disabled={pending}
            aria-label="Send message"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>

      {saveTarget && (
        <SaveToNotebookModal
          text={saveTarget.text}
          onClose={() => setSaveTarget(null)}
          onSaved={(noteId, mode) => {
            setSavedMessageIdx(saveTarget.messageIdx)
            setTimeout(() => setSavedMessageIdx(null), 2000)
            setSaveTarget(null)
            showToast(mode === 'append' ? 'Added to note' : 'Saved to a new note')
            onNoteSaved?.(noteId, mode)
          }}
        />
      )}
    </div>
  )
}
