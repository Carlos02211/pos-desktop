import type {
  AbonoInput,
  CreditAccountDetail,
  CreditAccountListItem,
  CreditQuery,
  Customer,
  CustomerInput,
  CustomerWithBalance
} from '@shared/types'
import { api } from './client'

/* ---- Clientes ---- */

export function listClientes(all = false): Promise<CustomerWithBalance[]> {
  return api.get<CustomerWithBalance[]>('/api/clientes', all ? { query: { all: '1' } } : undefined)
}

export function crearCliente(input: CustomerInput): Promise<Customer> {
  return api.post<Customer>('/api/clientes', input)
}

/* ---- Cuentas por cobrar ---- */

export function listCuentas(query: CreditQuery = {}): Promise<CreditAccountListItem[]> {
  return api.get<CreditAccountListItem[]>('/api/cuentas', { query: { ...query } })
}

export function getCuentaDetalle(id: number): Promise<CreditAccountDetail> {
  return api.get<CreditAccountDetail>(`/api/cuentas/${id}`)
}

export function totalPorCobrar(): Promise<{ total: number }> {
  return api.get<{ total: number }>('/api/cuentas/total')
}

export function registrarAbono(id: number, input: AbonoInput): Promise<CreditAccountDetail> {
  return api.post<CreditAccountDetail>(`/api/cuentas/${id}/abono`, input)
}
