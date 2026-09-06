import type {
  Category,
  CategoryInput,
  CategoryWithCount,
  Product,
  ProductInput,
  ProductWithCategory
} from '@shared/types'
import { api } from './client'

/* ---- Categorías ---- */

export function listCategoriasAdmin(): Promise<CategoryWithCount[]> {
  return api.get<CategoryWithCount[]>('/api/categorias', { query: { all: '1' } })
}

export function crearCategoria(input: CategoryInput): Promise<Category> {
  return api.post<Category>('/api/categorias', input)
}

export function actualizarCategoria(id: number, input: CategoryInput): Promise<Category> {
  return api.put<Category>(`/api/categorias/${id}`, input)
}

export function desactivarCategoria(id: number): Promise<void> {
  return api.delete<void>(`/api/categorias/${id}`)
}

/* ---- Productos ---- */

export function listProductosAdmin(): Promise<ProductWithCategory[]> {
  return api.get<ProductWithCategory[]>('/api/productos', { query: { all: '1' } })
}

export function crearProducto(input: ProductInput): Promise<Product> {
  return api.post<Product>('/api/productos', input)
}

export function actualizarProducto(id: number, input: ProductInput): Promise<Product> {
  return api.put<Product>(`/api/productos/${id}`, input)
}

export function desactivarProducto(id: number): Promise<void> {
  return api.delete<void>(`/api/productos/${id}`)
}

export function subirImagenProducto(id: number, file: File): Promise<{ path: string }> {
  const form = new FormData()
  form.append('file', file)
  return api.post<{ path: string }>(`/api/productos/${id}/imagen`, form)
}
