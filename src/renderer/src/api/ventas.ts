import type { CreateSaleInput, CreateSaleResponse } from '@shared/types'
import { api } from './client'

export function crearVenta(input: CreateSaleInput): Promise<CreateSaleResponse> {
  return api.post<CreateSaleResponse>('/api/ventas', input)
}

export function reimprimirTicket(saleId: number): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/api/ventas/${saleId}/reimprimir`)
}
