import type { Category, ProductWithCategory } from '@shared/types'
import { api } from './client'

export function getProductos(): Promise<ProductWithCategory[]> {
  return api.get<ProductWithCategory[]>('/api/productos')
}

export function getCategorias(): Promise<Category[]> {
  return api.get<Category[]>('/api/categorias')
}
