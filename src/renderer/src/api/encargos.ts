import type {
  CancelOrderInput,
  CreateOrderInput,
  CreateOrderResponse,
  Order,
  PrintResult
} from '@shared/types'
import { api } from './client'

/** Encargos pendientes (el más próximo primero) o ya entregados / cancelados. */
export function listarEncargos(status: 'PENDING' | 'CLOSED' = 'PENDING'): Promise<Order[]> {
  return api.get<Order[]>(`/api/encargos?status=${status}`)
}

/** Guarda el encargo; si dejan anticipo, se cobra en ese momento (venta aparte). */
export function crearEncargo(input: CreateOrderInput): Promise<CreateOrderResponse> {
  return api.post<CreateOrderResponse>('/api/encargos', input)
}

export function cancelarEncargo(id: number, input: CancelOrderInput): Promise<Order> {
  return api.post<Order>(`/api/encargos/${id}/cancelar`, input)
}

export function imprimirEncargo(id: number): Promise<PrintResult> {
  return api.post<PrintResult>(`/api/encargos/${id}/imprimir`)
}
