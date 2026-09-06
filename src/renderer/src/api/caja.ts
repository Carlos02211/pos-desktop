import type { CashSession, CashSessionSummary } from '@shared/types'
import { api } from './client'

export function getSesionActiva(): Promise<CashSession | null> {
  return api.get<CashSession | null>('/api/caja/sesion-activa')
}

export function getResumen(): Promise<CashSessionSummary> {
  return api.get<CashSessionSummary>('/api/caja/resumen')
}

export function abrirCaja(openingAmount: number): Promise<CashSession> {
  return api.post<CashSession>('/api/caja/apertura', { openingAmount })
}

export interface CloseResponse {
  session: CashSession
  summary: CashSessionSummary
  backup: { ok: boolean; path?: string; error?: string }
}

export function cerrarCaja(closingAmount: number): Promise<CloseResponse> {
  return api.post<CloseResponse>('/api/caja/cierre', { closingAmount })
}
