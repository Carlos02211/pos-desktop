import type { ApiError } from '@shared/types'

/**
 * Cliente HTTP del Renderer.
 *
 * Regla de oro de la arquitectura: el Renderer SÓLO habla HTTP contra el
 * servidor Fastify local. Nada de ipcRenderer para lógica de negocio.
 *
 * Fase 1: http://localhost:3001
 * Fase 2: cambiar únicamente esta constante a http://192.168.1.10:3000
 */
export const API_BASE_URL = 'http://localhost:3001'

/** Fuente del token JWT. En Sprint 1 se conecta al store de Zustand (en memoria). */
let tokenProvider: () => string | null = () => null

export function setTokenProvider(fn: () => string | null): void {
  tokenProvider = fn
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
