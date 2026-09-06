import type { ApiError } from '@shared/types'

/**
 * Cliente HTTP del Renderer.
 *
 * Regla de oro de la arquitectura: el Renderer SÓLO habla HTTP contra el
 * servidor Fastify. Nada de ipcRenderer para lógica de negocio.
 *
 * Resolución del `baseURL` (sin tocar código entre fases):
 *  - `VITE_API_BASE_URL` definida  → se usa tal cual (override manual).
 *  - Electron (dev o `file://`)     → `http://localhost:3001` (Fastify embebido).
 *  - SPA servida por HTTP (Fase 2)  → mismo origen que la página.
 */
function resolveApiBaseUrl(): string {
  const override = import.meta.env.VITE_API_BASE_URL
  if (override) return override

  // electron-vite marca el arranque de desarrollo.
  if (import.meta.env.DEV) return 'http://localhost:3001'

  if (typeof window !== 'undefined') {
    // Electron empaquetado carga el Renderer desde `file://`.
    if (window.location.protocol === 'file:') return 'http://localhost:3001'
    // Fase 2: la SPA la sirve el propio servidor → misma URL base.
    return window.location.origin
  }

  return 'http://localhost:3001'
}

export const API_BASE_URL = resolveApiBaseUrl()

/** Fuente del token JWT. En Sprint 1 se conecta al store de Zustand (en memoria). */
let tokenProvider: () => string | null = () => null

export function setTokenProvider(fn: () => string | null): void {
  tokenProvider = fn
}

/** Se invoca cuando el servidor responde 401 (token expirado/ inválido). */
let onUnauthorized: () => void = () => {}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** Parámetros de query. */
  query?: Record<string, string | number | boolean | undefined>
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options

  const url = new URL(path, API_BASE_URL)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }

  const finalHeaders = new Headers(headers)
  const token = tokenProvider()
  if (token) finalHeaders.set('Authorization', `Bearer ${token}`)

  let payload: BodyInit | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    finalHeaders.set('Content-Type', 'application/json')
    payload = JSON.stringify(body)
  }

  const res = await fetch(url, { ...rest, headers: finalHeaders, body: payload })

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json() : await res.text()

  if (!res.ok) {
    const err = (isJson ? data : { error: data }) as ApiError
    if (res.status === 401 && tokenProvider()) onUnauthorized()
    throw new ApiRequestError(res.status, err.error ?? `HTTP ${res.status}`, err.details)
  }

  return data as T
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    apiFetch<T>(path, { ...opts, method: 'DELETE' })
}
