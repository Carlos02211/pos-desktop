import type {
  AddToSaleInput,
  AddToSaleResponse,
  CreateSaleInput,
  CreateSaleResponse,
  TurnSale
} from '@shared/types'
import { api } from './client'

export function crearVenta(input: CreateSaleInput): Promise<CreateSaleResponse> {
  return api.post<CreateSaleResponse>('/api/ventas', input)
}

/** Ventas del turno abierto (el cobrador ve las de su caja; el admin, las de todas). */
export function ventasDelTurno(): Promise<TurnSale[]> {
  return api.get<TurnSale[]>('/api/ventas/turno')
}

/** Productos que el cliente olvidó: se suman a la venta con el mismo folio. */
export function agregarAVenta(saleId: number, input: AddToSaleInput): Promise<AddToSaleResponse> {
  return api.post<AddToSaleResponse>(`/api/ventas/${saleId}/agregar`, input)
}

/** Reimprime el ticket (el cobrador, sólo el último de su caja). Sale marcado como copia. */
export function reimprimirVenta(saleId: number): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/api/ventas/${saleId}/reimprimir`)
}
