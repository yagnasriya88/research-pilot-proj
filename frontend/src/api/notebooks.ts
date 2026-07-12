import { api } from './client'
import type { Notebook, NotebookSummary } from './types'

export const notebooksApi = {
  list: () => api.get<NotebookSummary[]>('/notebooks'),
  get: (id: string) => api.get<Notebook>(`/notebooks/${id}`),
  create: (title: string, content = '') => api.post<Notebook>('/notebooks', { title, content }),
  update: (id: string, body: { title?: string; content?: string }) =>
    api.patch<Notebook>(`/notebooks/${id}`, body),
  remove: (id: string) => api.delete(`/notebooks/${id}`),
}
