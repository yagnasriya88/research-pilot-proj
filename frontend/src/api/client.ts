export const API_ORIGIN = import.meta.env.VITE_API_BASE_URL ?? ''
const BASE = `${API_ORIGIN}/api`
const TOKEN_KEY = 'authToken'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function handleUnauthorized() {
  clearToken()
  if (location.pathname !== '/login' && location.pathname !== '/signup') {
    location.href = '/login'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
  })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// FastAPI's HTTPException bodies are JSON like `{"detail":"..."}`; request() throws
// `Error("<status> <raw body>")`, so this pulls the human-readable `detail` back out for
// display, falling back to a caller-supplied message when the body isn't in that shape.
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const match = err.message.match(/^\d+\s+([\s\S]*)$/)
    if (match) {
      try {
        const parsed = JSON.parse(match[1])
        if (typeof parsed?.detail === 'string') return parsed.detail
      } catch {
        // body wasn't JSON — fall through to fallback
      }
    }
  }
  return fallback
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) =>
    fetch(`${BASE}${path}`, { method: 'POST', body: form, headers: authHeaders() }).then(async (res) => {
      if (res.status === 401) handleUnauthorized()
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
      return res.json() as Promise<T>
    }),
}
