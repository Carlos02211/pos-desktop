import type { AuthUser, LoginResponse } from '@shared/types'
import { api } from './client'

export function login(username: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>('/api/auth/login', { username, password })
}

export function logout(): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>('/api/auth/logout')
}

export function me(): Promise<{ user: AuthUser }> {
  return api.get<{ user: AuthUser }>('/api/auth/me')
}
