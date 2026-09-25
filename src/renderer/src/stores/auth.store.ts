import { create } from 'zustand'
import type { AuthUser } from '@shared/types'

/**
 * Sesión del usuario. Se guarda en `sessionStorage` (nunca `localStorage`): sobrevive a
 * una recarga accidental (F5) pero se borra al cerrar la pestaña/ventana, así una caja
 * compartida no queda con la sesión abierta. El token dura 8 h y, al restaurarlo, se
 * revalida con `/api/auth/me` (ver `main.tsx`); si venció, el 401 limpia la sesión.
 */
interface AuthState {
  token: string | null
  user: AuthUser | null
  setAuth: (token: string, user: AuthUser) => void
  clear: () => void
}

const STORAGE_KEY = 'pos-session'

function loadSession(): Pick<AuthState, 'token' | 'user'> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { token?: unknown; user?: AuthUser }
      if (typeof parsed.token === 'string' && parsed.user) {
        return { token: parsed.token, user: parsed.user }
      }
    }
  } catch {
    // Storage bloqueado o JSON corrupto: se arranca sin sesión.
  }
  return { token: null, user: null }
}

function saveSession(token: string | null, user: AuthUser | null): void {
  try {
    if (token && user) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Sin storage la sesión sólo vive en memoria (se pierde al recargar).
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  ...loadSession(),
  setAuth: (token, user) => {
    saveSession(token, user)
    set({ token, user })
  },
  clear: () => {
    saveSession(null, null)
    set({ token: null, user: null })
  }
}))

/** Acceso sin hook, para el interceptor de `api/client.ts`. */
export const getToken = (): string | null => useAuthStore.getState().token
