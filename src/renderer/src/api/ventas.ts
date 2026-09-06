import type { CreateSaleInput, SaleWithItems } from '@shared/types'
import { api } from './client'

export function crearVenta(input: CreateSaleInput): Promise<SaleWithItems> {
  return api.post<SaleWithItems>('/api/ventas', input)
}
