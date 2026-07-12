import { fetchEventSource } from '@microsoft/fetch-event-source'
import { api, API_ORIGIN, authHeaders } from './client'
import type {
  Chat,
  ChatSummary,
  ChatType,
  DeepResearchMode,
  DeepResearchScope,
  ExcerptRef,
  ImageExcerptRef,
  MessageOutput,
  SearchScope,
} from './types'

export const chatsApi = {
  list: (type?: ChatType) => api.get<ChatSummary[]>(`/chats${type ? `?type=${type}` : ''}`),
  get: (id: string) => api.get<Chat>(`/chats/${id}`),
  getForPaper: (paperId: string) => api.get<Chat>(`/chats/for-paper/${paperId}`),
  getForBook: (bookId: string) => api.get<Chat>(`/chats/for-book/${bookId}`),
  create: (params: {
    type?: ChatType
    sourceFolderIds?: string[]
    sourcePaperIds?: string[]
    sourceBookId?: string
    title?: string
    deepResearchScope?: DeepResearchScope
    deepResearchMode?: DeepResearchMode
    searchScope?: SearchScope
  }) => api.post<Chat>('/chats', params),
  rename: (id: string, title: string) => api.patch<Chat>(`/chats/${id}`, { title }),
  remove: (id: string) => api.delete(`/chats/${id}`),
  addSource: (id: string, params: { paperId?: string; folderId?: string }) =>
    api.post<Chat>(`/chats/${id}/sources`, params),

  streamMessage: (
    chatId: string,
    content: string,
    handlers: {
      onOutput?: (output: MessageOutput) => void
      onStage?: (stage: { stage: string; status: string; detail?: string }) => void
      onDelta: (text: string) => void
      onDone: (fullText: string) => void
      onError: (err: unknown) => void
    },
    excerpt?: ExcerptRef,
    imageExcerpt?: ImageExcerptRef,
  ) => {
    const controller = new AbortController()
    fetchEventSource(`${API_ORIGIN}/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content, excerpt, imageExcerpt }),
      signal: controller.signal,
      onmessage(ev) {
        const payload = JSON.parse(ev.data) as {
          delta?: string
          done?: boolean
          content?: string
          output?: MessageOutput
          stage?: string
          status?: string
          detail?: string
          error?: string
        }
        if (payload.output) handlers.onOutput?.(payload.output)
        if (payload.stage) handlers.onStage?.({ stage: payload.stage, status: payload.status!, detail: payload.detail })
        if (payload.delta) handlers.onDelta(payload.delta)
        if (payload.done) handlers.onDone(payload.content ?? '')
        if (payload.error) handlers.onError(new Error(payload.error))
      },
      onerror(err) {
        handlers.onError(err)
        throw err // stop retrying
      },
    })
    return controller
  },
}
