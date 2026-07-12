import { api } from './client'
import type { Folder, Paper, Tag } from './types'

export const referencesApi = {
  listFolders: () => api.get<Folder[]>('/references/folders'),
  createFolder: (name: string, parentId?: string | null) =>
    api.post<Folder>('/references/folders', { name, parentId }),
  deleteFolder: (id: string) => api.delete(`/references/folders/${id}`),

  listTags: () => api.get<Tag[]>('/references/tags'),
  createTag: (name: string, color?: string) => api.post<Tag>('/references/tags', { name, color }),
  deleteTag: (id: string) => api.delete(`/references/tags/${id}`),

  listPapers: (params?: Record<string, string | number | boolean | undefined>) => {
    const query = new URLSearchParams()
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== '') query.set(k, String(v))
    }
    const qs = query.toString()
    return api.get<Paper[]>(`/references/papers${qs ? `?${qs}` : ''}`)
  },
  getPaper: (id: string) => api.get<Paper>(`/references/papers/${id}`),
  updatePaper: (id: string, body: { title?: string; folderId?: string | null; tagIds?: string[] }) =>
    api.patch<Paper>(`/references/papers/${id}`, body),
  deletePaper: (id: string) => api.delete(`/references/papers/${id}`),

  uploadFile: (file: File, folderId?: string | null) => {
    const form = new FormData()
    form.append('file', file)
    if (folderId) form.append('folderId', folderId)
    return api.postForm<Paper>('/references/papers/upload-file', form)
  },
  uploadUrl: (body: { url?: string; doi?: string; folderId?: string | null }) =>
    api.post<Paper>('/references/papers/upload-url', body),
  addManual: (body: {
    title: string
    authors?: string[]
    year?: number
    venue?: string
    doi?: string
    folderId?: string | null
  }) => api.post<Paper>('/references/papers/manual', body),
  saveFromSearch: (body: {
    title: string
    authors?: string[]
    year?: number | null
    venue?: string | null
    doi?: string | null
    abstract?: string | null
    citationCount?: number | null
    url?: string | null
    pdfUrl?: string | null
    folderId?: string | null
  }) => api.post<Paper>('/references/papers/from-search', body),
}
