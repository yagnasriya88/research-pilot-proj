import { api } from './client'
import type { Highlight, HighlightColor, HighlightRect } from './types'

export const highlightsApi = {
  list: (paperId: string) => api.get<Highlight[]>(`/references/papers/${paperId}/highlights`),
  create: (paperId: string, body: { page: number; color: HighlightColor; rects: HighlightRect[]; quote: string }) =>
    api.post<Highlight>(`/references/papers/${paperId}/highlights`, body),
}
