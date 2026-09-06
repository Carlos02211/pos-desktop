import { create } from 'zustand'
import type { LicenseStatusResponse } from '@shared/types'
import { getLicenseStatus } from '@/api/license'

type Phase = 'loading' | 'ready' | 'unreachable'

interface LicenseState {
  phase: Phase
  status: LicenseStatusResponse | null
  /** Consulta el estado de licencia al servidor. Se llama al arrancar y tras activar. */
  refresh: () => Promise<void>
  set: (status: LicenseStatusResponse) => void
}

export const useLicenseStore = create<LicenseState>((set) => ({
  phase: 'loading',
  status: null,
  refresh: async () => {
    try {
      const status = await getLicenseStatus()
      set({ phase: 'ready', status })
    } catch {
      set({ phase: 'unreachable' })
    }
  },
  set: (status) => set({ phase: 'ready', status })
}))
