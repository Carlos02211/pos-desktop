import { create } from 'zustand'
import type { AuthUser } from '@shared/types'

/**
 * Sesión del usuario. El token vive SÓLO en memoria (nunca localStorage) —
 * regla de desarrollo del proyecto. Al recargar la app se vuelve a pedir login.
 */
interface AuthState {
  token: string | null
  user: AuthUser | null
  setAuth: (token: string, user: AuthUser) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  setAuth: (token, user) => set({ token, user }),
  clear: () => set({ token: null, user: null })
}))

/** Acceso sin hook, para el interceptor de `api/client.ts`. */
export const getToken = (): string | null => useAuthStore.getState().token
