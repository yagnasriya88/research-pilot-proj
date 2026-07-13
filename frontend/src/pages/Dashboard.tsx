import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search,
  MessageCircle,
  FileText,
  ChevronDown,
  Paperclip,
  ArrowRight,
  FileSignature,
  GitCompare,
  HelpCircle,
  BookOpen,
  Hash,
  Leaf,
  Cpu,
  Apple,
  Stethoscope,
  HeartPulse,
  Globe,
  GraduationCap,
  Brain,
  Scale,
  FlaskConical,
  Building2,
  Home as HomeIcon,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import { chatsApi } from '../api/chats'
import { notebooksApi } from '../api/notebooks'
import { referencesApi } from '../api/references'
import type { ChatSummary, ChatType, DeepResearchMode, NotebookSummary } from '../api/types'
import { SourceScopeDropdown, type SourceScopeValue } from '../components/SourceScopeDropdown'
import { EmptyState } from '../components/EmptyState'
import { useAuth } from '../auth/AuthContext'

const AGENTS: { type: ChatType; label: string; icon: LucideIcon; description: string }[] = [
  { type: 'search', label: 'AI Search', icon: Search, description: 'Search papers and get cited answers.' },
  { type: 'chat_with_pdf', label: 'Chat with PDF', icon: MessageCircle, description: 'Ask questions and get cited answers from PDFs.' },
  { type: 'deep_research', label: 'Deep Research Report', icon: FileText, description: 'Generate a detailed, cited report from papers.' },
]

const TYPE_LABEL: Record<ChatType, string> = {
  chat_with_pdf: 'Chat with PDF',
  chat_with_book: 'Chat with Book',
  search: 'AI Search',
  deep_research: 'Deep Research',
}

const CHAT_WITH_PDF_SUGGESTIONS: { icon: LucideIcon; label: string }[] = [
  { icon: FileSignature, label: 'Summarize a research paper' },
  { icon: GitCompare, label: 'Compare key claims across papers' },
  { icon: HelpCircle, label: 'Find evidence for a claim' },
  { icon: BookOpen, label: 'Extract the study population' },
  { icon: Search, label: 'Get a brief overview of the topic' },
  { icon: Hash, label: 'Extract numbers & metrics' },
]

const SEARCH_SUGGESTIONS: { category: string; icon: LucideIcon; questions: string[] }[] = [
  {
    category: 'Environment',
    icon: Leaf,
    questions: [
      'What is the association between long-term PM2.5 exposure and cardiovascular mortality?',
      'How does climate change affect the frequency and intensity of heatwaves globally?',
      'Do microplastics in drinking water pose measurable risks to human health?',
      'How effective is carbon capture and storage at reducing industrial CO2 emissions at scale?',
      'What are the biodiversity impacts of renewable energy expansion (wind/solar) on local ecosystems?',
    ],
  },
  {
    category: 'Technology',
    icon: Cpu,
    questions: [
      'How reliable are common LLM evaluation benchmarks at predicting real-world performance?',
      'How accurate are AI models for detecting breast cancer on mammography?',
      'Do wearables reliably detect atrial fibrillation compared to clinical ECG?',
      'What techniques best reduce hallucinations in medical or scientific LLM outputs?',
    ],
  },
  {
    category: 'Fitness & Nutrition',
    icon: Apple,
    questions: [
      'Do ultra-processed foods increase risk of cardiovascular disease and mortality?',
      'Is intermittent fasting more effective than daily calorie restriction for fat loss and metabolic health?',
      'Does resistance training reduce depression and anxiety symptoms compared to no exercise?',
      'How does sleep duration and quality affect body composition and appetite regulation?',
      'Are plant-based diets associated with lower risk of type 2 diabetes and heart disease?',
    ],
  },
  {
    category: 'Clinical Medicine',
    icon: Stethoscope,
    questions: [
      'Are GLP-1 receptor agonists effective and safe for long-term weight loss?',
      'Does metformin reduce progression from prediabetes to type 2 diabetes in real-world studies?',
      'Is early physical therapy effective for reducing pain and disability in low back pain?',
      'Are proton pump inhibitors associated with increased risk of kidney disease?',
      'What is the comparative effectiveness of CBT vs SSRIs for generalized anxiety disorder?',
    ],
  },
  {
    category: 'Healthcare',
    icon: HeartPulse,
    questions: [
      'Does long-term PM2.5 exposure increase risk of dementia?',
      'What is the association between heat exposure and cardiovascular mortality among outdoor workers?',
      'Does night shift work increase risk of type 2 diabetes and metabolic syndrome?',
      'How strongly is alcohol consumption linked to all-cause mortality across dose ranges?',
    ],
  },
]

const DEEP_RESEARCH_SUGGESTIONS: { icon: LucideIcon; title: string; question: string }[] = [
  {
    icon: Globe,
    title: 'Social media and mental health',
    question: 'How does daily social media use relate to anxiety, depression, or self-esteem in young adults?',
  },
  {
    icon: GraduationCap,
    title: 'AI in education',
    question: 'Does personalized learning with AI tools improve student outcomes compared to traditional instruction?',
  },
  {
    icon: Brain,
    title: 'Sleep and academic performance',
    question: 'How does sleep duration/quality predict grades, attention, and memory in students?',
  },
  {
    icon: Scale,
    title: 'Bias and fairness in AI',
    question: 'Which bias-mitigation methods most effectively reduce unfair outcomes without hurting performance?',
  },
  {
    icon: FlaskConical,
    title: 'Reproducibility in science',
    question: 'What are the most common causes of failed replication, and which interventions improve reproducibility?',
  },
  {
    icon: Building2,
    title: 'Urban green spaces and wellbeing',
    question: 'Do nearby parks and green spaces measurably improve mental wellbeing and stress levels in cities?',
  },
  {
    icon: HomeIcon,
    title: 'Remote work and productivity',
    question: 'What impact does remote work have on productivity and job satisfaction across different roles?',
  },
  {
    icon: Lock,
    title: 'Data privacy and user trust',
    question: 'How do privacy policies and consent prompts influence user trust and willingness to share data?',
  },
]

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const firstName = user?.name?.trim().split(/\s+/)[0]
  const [searchParams] = useSearchParams()
  const initialAgent = (searchParams.get('agent') as ChatType | null) ?? 'search'
  const [agent, setAgent] = useState<ChatType>(initialAgent)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [sourceScope, setSourceScope] = useState<SourceScopeValue>(
    initialAgent === 'chat_with_pdf' ? { kind: 'reference_manager', folderIds: [], paperIds: [] } : { kind: 'all_papers' },
  )
  const [deepResearchMode, setDeepResearchMode] = useState<DeepResearchMode>('standard')
  const [recentChats, setRecentChats] = useState<ChatSummary[]>([])
  const [recentNotebooks, setRecentNotebooks] = useState<NotebookSummary[]>([])
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    chatsApi.list().then((chats) => setRecentChats(chats.slice(0, 5)))
    notebooksApi.list().then((nbs) => setRecentNotebooks(nbs.slice(0, 5)))
  }, [])

  // Chat with PDF can only ever work over already-ingested papers — force that scope.
  useEffect(() => {
    if (agent === 'chat_with_pdf' && sourceScope.kind !== 'reference_manager') {
      setSourceScope({ kind: 'reference_manager', folderIds: [], paperIds: [] })
    }
  }, [agent, sourceScope])

  // Deep Research (Standard mode) only accepts a single whole folder — drop an incompatible
  // multi-paper/folder selection.
  useEffect(() => {
    if (
      agent === 'deep_research' &&
      sourceScope.kind === 'reference_manager' &&
      (sourceScope.paperIds.length > 0 || sourceScope.folderIds.length > 1)
    ) {
      setSourceScope({ kind: 'all_papers' })
    }
  }, [agent, sourceScope])

  // Deeper Search only makes sense against the open web, not ArXiv-only or a folder scope.
  useEffect(() => {
    if (agent === 'deep_research' && sourceScope.kind !== 'all_papers' && deepResearchMode === 'openai') {
      setDeepResearchMode('standard')
    }
  }, [agent, sourceScope, deepResearchMode])

  const canSubmit =
    question.trim().length > 0 &&
    !(agent === 'chat_with_pdf' && sourceScope.kind === 'reference_manager' && sourceScope.folderIds.length === 0 && sourceScope.paperIds.length === 0)

  async function handleSubmit() {
    if (!canSubmit) return
    setCreating(true)
    try {
      const isRefScope = sourceScope.kind === 'reference_manager'
      const deepResearchScope = isRefScope ? 'folder' : sourceScope.kind === 'arxiv' ? 'arxiv' : 'external'
      const chat = await chatsApi.create({
        type: agent,
        sourceFolderIds: isRefScope ? sourceScope.folderIds : [],
        sourcePaperIds: agent !== 'deep_research' && isRefScope ? sourceScope.paperIds : [],
        title: question.slice(0, 80),
        deepResearchScope: agent === 'deep_research' ? deepResearchScope : undefined,
        deepResearchMode: agent === 'deep_research' ? deepResearchMode : undefined,
        searchScope: agent === 'search' ? sourceScope.kind : undefined,
      })
      navigate(`/chats/${chat.id}`, { state: { initialMessage: question } })
    } finally {
      setCreating(false)
    }
  }

  async function handleAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const paper = await referencesApi.uploadFile(file)
    if (agent === 'deep_research') return // Deep Research only accepts a whole folder, not an individual paper
    setSourceScope((prev) => {
      const base = prev.kind === 'reference_manager' ? prev : { kind: 'reference_manager' as const, folderIds: [], paperIds: [] }
      return { ...base, paperIds: [...base.paperIds, paper.id] }
    })
  }

  return (
    <div className="dashboard">
      <h1 className="dashboard-heading serif">
        Hello{firstName ? ` ${firstName}` : ''}, what would you like to research today?
      </h1>

      <div className="ask-box">
        <textarea
          ref={textareaRef}
          placeholder={
            agent === 'search'
              ? 'Ask a research question or topic to find papers and answers...'
              : agent === 'deep_research'
                ? 'Describe the topic for your Deep Research Report...'
                : 'Ask a question about your saved papers...'
          }
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="ask-box-controls">
          <div className="ask-box-controls-left">
            <div className="dropdown">
              <button className="btn btn-pill" onClick={() => setAgentMenuOpen((v) => !v)}>
                {(() => {
                  const Icon = AGENTS.find((a) => a.type === agent)?.icon
                  return Icon ? <Icon size={14} /> : null
                })()}
                {TYPE_LABEL[agent]}
                <ChevronDown size={14} />
              </button>
              {agentMenuOpen && (
                <div className="dropdown-menu">
                  <div className="dropdown-section-label">Select Research Agent:</div>
                  {AGENTS.map((a) => (
                    <div
                      key={a.type}
                      className={`dropdown-item${agent === a.type ? ' selected' : ''}`}
                      onClick={() => {
                        setAgent(a.type)
                        setAgentMenuOpen(false)
                      }}
                    >
                      <span className="dropdown-item-label">
                        <a.icon size={14} /> {a.label}
                      </span>
                      <span className="dropdown-item-sub">{a.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <SourceScopeDropdown agent={agent} value={sourceScope} onChange={setSourceScope} />

            {agent === 'deep_research' && (
              <div
                className="segmented"
                title={
                  sourceScope.kind !== 'all_papers'
                    ? "Deeper Search searches the open web and isn't compatible with ArXiv-only or folder scope"
                    : undefined
                }
              >
                <button
                  className={`segmented-option${deepResearchMode === 'standard' ? ' active' : ''}`}
                  onClick={() => setDeepResearchMode('standard')}
                >
                  Standard
                </button>
                <button
                  className={`segmented-option${deepResearchMode === 'openai' ? ' active' : ''}`}
                  disabled={sourceScope.kind !== 'all_papers'}
                  onClick={() => setDeepResearchMode('openai')}
                >
                  Deeper Search
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handleAttach} />
            <button
              className="btn btn-icon"
              title={
                agent === 'deep_research'
                  ? 'Attach a PDF (added to Reference Manager — pick a folder above to use it)'
                  : 'Attach a PDF'
              }
              aria-label="Attach a PDF"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={15} />
            </button>
            <button
              className="btn btn-primary btn-icon"
              onClick={handleSubmit}
              disabled={creating || !canSubmit}
              aria-label="Submit"
            >
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {agent === 'chat_with_pdf' && (
        <div className="suggestions-section">
          <div className="suggestions-title">Ask your PDF/Papers anything</div>
          <div className="suggestions-grid-3col">
            {CHAT_WITH_PDF_SUGGESTIONS.map((s) => (
              <button key={s.label} className="suggestion-chip" onClick={() => setQuestion(s.label)}>
                <s.icon size={15} /> {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {agent === 'search' && (
        <div className="suggestions-section">
          <div className="suggestions-title">Explore sample research questions</div>
          {SEARCH_SUGGESTIONS.map((cat) => (
            <div key={cat.category} className="suggestions-category">
              <div className="suggestions-category-label">
                <cat.icon size={15} /> {cat.category}
              </div>
              <div className="suggestions-pill-row">
                {cat.questions.map((q) => (
                  <button key={q} className="suggestion-pill" onClick={() => setQuestion(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {agent === 'deep_research' && (
        <div className="suggestions-section">
          <div className="suggestions-title">Start a deep research report with</div>
          <div className="suggestions-card-grid">
            {DEEP_RESEARCH_SUGGESTIONS.map((s) => (
              <button key={s.title} className="suggestion-card" onClick={() => setQuestion(s.question)}>
                <div className="suggestion-card-title">
                  <s.icon size={15} /> {s.title}
                </div>
                <div className="suggestion-card-desc">{s.question}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section-title">Recent Chats</div>
      <div className="card-list">
        {recentChats.length === 0 && (
          <EmptyState
            title="No chats yet"
            description="Ask a question above to start your first conversation."
            action={{ label: 'Ask a question', onClick: () => textareaRef.current?.focus() }}
          />
        )}
        {recentChats.map((c) => (
          <div key={c.id} className="list-card" onClick={() => navigate(`/chats/${c.id}`)}>
            <span className="list-card-title">{c.title}</span>
            <span className="list-card-meta">{TYPE_LABEL[c.type]}</span>
          </div>
        ))}
      </div>

      <div className="section-title">Recent Notebooks</div>
      <div className="card-list">
        {recentNotebooks.length === 0 && <EmptyState title="No notebooks yet" description="Notes you save from chats will show up here." />}
        {recentNotebooks.map((n) => (
          <div key={n.id} className="list-card" onClick={() => navigate(`/my-notebooks`)}>
            <span className="list-card-title">{n.title}</span>
            <span className="list-card-meta">{new Date(n.updatedAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
