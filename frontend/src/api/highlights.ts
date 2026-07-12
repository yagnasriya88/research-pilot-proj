import { api } from './client'
import type { Highlight, HighlightColor, HighlightRect } from './types'

export const highlightsApi = {
  list: (paperId: string) => api.get<Highlight[]>(`/references/papers/${paperId}/highlights`),
  create: (paperId: string, body: { page: number; color: HighlightColor; rects: HighlightRect[]; quote: string }) =>
    api.post<Highlight>(`/references/papers/${paperId}/highlights`, body),
}

// Structurally identical to highlightsApi, targeting the parallel book_highlights
// collection/routes — kept separate rather than parameterizing one client, matching
// the app's "books are a parallel system" pattern throughout the backend.
export const bookHighlightsApi = {
  list: (bookId: string) => api.get<Highlight[]>(`/books/${bookId}/highlights`),
  create: (bookId: string, body: { page: number; color: HighlightColor; rects: HighlightRect[]; quote: string }) =>
    api.post<Highlight>(`/books/${bookId}/highlights`, body),
}
