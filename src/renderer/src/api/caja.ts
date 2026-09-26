import type {
  CashMovement,
  CashMovementInput,
  CashSession,
  CashSessionSummary,
  DrawerResult
} from '@shared/types'
import { api } from './client'

export function getSesionActiva(): Promise<CashSession | null> {
  return api.get<CashSession | null>('/api/caja/sesion-activa')
}

/** ¿El negocio tiene cajón de dinero configurado? (muestra el botón en el cobrador) */
export async function cajonActivo(): Promise<boolean> {
  return (await api.get<{ enabled: boolean }>('/api/caja/cajon')).enabled
}

export function abrirCajon(): Promise<DrawerResult> {
  return api.post<DrawerResult>('/api/caja/cajon', {})
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

export function getMovimientos(): Promise<CashMovement[]> {
  return api.get<CashMovement[]>('/api/caja/movimientos')
}

export function registrarMovimiento(input: CashMovementInput): Promise<CashMovement> {
  return api.post<CashMovement>('/api/caja/movimiento', input)
}
