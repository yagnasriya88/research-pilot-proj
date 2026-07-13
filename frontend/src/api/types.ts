export type IngestionStatus = 'pending' | 'ready' | 'no_pdf' | 'failed'

export interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  tokenType: string
  user: User
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
}

export interface Tag {
  id: string
  name: string
  color: string
}

export interface Paper {
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  abstract?: string | null
  citationCount?: number | null
  sourceUrl?: string | null
  type: string
  folderId: string | null
  tagIds: string[]
  source: 'upload' | 'url' | 'manual'
  ingestionStatus: IngestionStatus
  pageCount?: number
  createdAt: string
}

export type ChatType = 'chat_with_pdf' | 'chat_with_book' | 'search' | 'deep_research'
export type SearchScope = 'all_papers' | 'arxiv' | 'reference_manager'

export interface ChatFolderRef {
  id: string
  name: string
  paperCount: number
}

export interface ChatPaperRef {
  id: string
  title: string
}

export interface ChatBookRef {
  id: string
  title: string
}

export interface ChatSources {
  folders: ChatFolderRef[]
  papers: ChatPaperRef[]
  book: ChatBookRef | null
}

export interface SearchResult {
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  doi: string | null
  url: string | null
  pdfUrl: string | null
  citationCount: number | null
  source: 'semantic_scholar' | 'arxiv'
}

export interface ReportReference {
  index: number
  title: string
  authors: string[]
  year: number | null
  url: string | null
  paperId: string | null
}

export type MessageOutput =
  | { kind: 'papers'; results: SearchResult[] }
  | { kind: 'document'; markdown: string; references: ReportReference[] }

export interface ExcerptRef {
  paperId?: string
  quote: string
  page: number
}

export interface ImageExcerptRef {
  page: number
  imageBase64: string
}

export interface ImageExcerptMessage {
  page: number
  imageFileId: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  output?: MessageOutput
  excerpt?: ExcerptRef
  imageExcerpt?: ImageExcerptMessage
}

export type DeepResearchScope = 'external' | 'arxiv' | 'folder'
export type DeepResearchMode = 'standard' | 'openai'

export interface DeepResearchStage {
  // 'plan'/'search'/'screen'/'extract'/'synthesize' (Standard mode) or 'planning'/'research'
  // (Deeper Search/OpenAI mode).
  name: string
  status: 'pending' | 'running' | 'done' | 'failed'
  detail?: string
}

export interface Chat {
  id: string
  type: ChatType
  title: string
  sourceFolderIds: string[]
  sourcePaperIds: string[]
  sourceBookId: string | null
  deepResearchScope: DeepResearchScope | null
  deepResearchMode: DeepResearchMode | null
  searchScope: SearchScope | null
  deepResearchStages: DeepResearchStage[] | null
  sources: ChatSources
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

export interface ChatSummary {
  id: string
  type: ChatType
  title: string
  sourceFolderIds: string[]
  sourcePaperIds: string[]
  sourceBookId: string | null
  sources: ChatSources
  createdAt: string
  updatedAt: string
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

export interface HighlightRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Highlight {
  id: string
  paperId: string
  page: number
  color: HighlightColor
  rects: HighlightRect[]
  quote: string
  createdAt: string
}

export interface Notebook {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface NotebookSummary {
  id: string
  title: string
  snippet: string
  createdAt: string
  updatedAt: string
}

export type BookIngestionStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface TocEntry {
  title: string
  page: number
  level: number
}

export interface Book {
  id: string
  title: string
  author: string | null
  pageCount: number | null
  totalTokens: number | null
  tableOfContents: TocEntry[]
  ingestionStatus: BookIngestionStatus
  createdAt: string
  updatedAt: string
}
