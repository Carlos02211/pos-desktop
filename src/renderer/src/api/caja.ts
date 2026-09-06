import type { CashSession } from '@shared/types'
import { api } from './client'

export function getSesionActiva(): Promise<CashSession | null> {
  return api.get<CashSession | null>('/api/caja/sesion-activa')
}

export function abrirCaja(openingAmount: number): Promise<CashSession> {
  return api.post<CashSession>('/api/caja/apertura', { openingAmount })
}
