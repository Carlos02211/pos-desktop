import { create } from 'zustand'
import type { BrandingResponse } from '@shared/types'
import { api, API_BASE_URL } from '@/api/client'

/**
 * Marca del NEGOCIO (no de SpArTaN Tech): nombre y logo configurados en Admin →
 * Configuración. La usan la barra superior, el login y el título de la pestaña.
 */
interface BrandingState {
  name: string
  /** URL absoluta del logo, o null si no hay. */
  logoUrl: string | null
  load: () => Promise<void>
  set: (branding: BrandingResponse) => void
}

function toState(b: BrandingResponse): Pick<BrandingState, 'name' | 'logoUrl'> {
  return {
    name: b.businessName.trim(),
    logoUrl: b.logoPath ? `${API_BASE_URL}/uploads/${b.logoPath}` : null
  }
}

function applyTitle(name: string): void {
  document.title = name ? `${name} · Punto de venta` : 'Punto de venta'
}

export const useBrandingStore = create<BrandingState>((set) => ({
  name: '',
  logoUrl: null,
  load: async () => {
    try {
      const next = toState(await api.get<BrandingResponse>('/api/marca'))
      applyTitle(next.name)
      set(next)
    } catch {
      // Sin marca se muestran los textos genéricos; no bloquea el uso.
    }
  },
  set: (b) => {
    const next = toState(b)
    applyTitle(next.name)
    set(next)
  }
}))
