import type {
  AddToTabInput,
  CancelOrderInput,
  CartLineInput,
  CreateTabInput,
  CreateOrderInput,
  CreateOrderResponse,
  Order,
  PrintResult,
  TabResponse
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

/* ---- Cuentas abiertas (mesas) ---- */

export function listarCuentasAbiertas(status: 'PENDING' | 'CLOSED' = 'PENDING'): Promise<Order[]> {
  return api.get<Order[]>(`/api/cuentas-abiertas?status=${status}`)
}

export function abrirCuenta(input: CreateTabInput): Promise<TabResponse> {
  return api.post<TabResponse>('/api/cuentas-abiertas', input)
}

export function agregarACuenta(id: number, input: AddToTabInput): Promise<TabResponse> {
  return api.post<TabResponse>(`/api/cuentas-abiertas/${id}/agregar`, input)
}

/** Deja la cuenta como viene (correcciones sin cobrar). */
export function guardarCuenta(
  id: number,
  items: CartLineInput[],
  version: number
): Promise<TabResponse> {
  return api.put<TabResponse>(`/api/cuentas-abiertas/${id}`, { items, version })
}

export function imprimirCuenta(id: number): Promise<PrintResult> {
  return api.post<PrintResult>(`/api/cuentas-abiertas/${id}/imprimir`)
}
