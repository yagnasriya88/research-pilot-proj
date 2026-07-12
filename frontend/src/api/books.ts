import { api } from './client'
import type { Book } from './types'

export const booksApi = {
  list: () => api.get<Book[]>('/books'),
  get: (id: string) => api.get<Book>(`/books/${id}`),
  update: (id: string, body: { title?: string; author?: string }) => api.patch<Book>(`/books/${id}`, body),
  remove: (id: string) => api.delete(`/books/${id}`),
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.postForm<Book>('/books/upload', form)
  },
}
