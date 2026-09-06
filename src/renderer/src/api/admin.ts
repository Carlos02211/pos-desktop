import type {
  CashHistoryQuery,
  CashSessionListItem,
  Category,
  CategoryInput,
  CategoryWithCount,
  CreateUserInput,
  DashboardData,
  Product,
  ProductInput,
  ProductWithCategory,
  ReportType,
  SalesReport,
  SaleWithItems,
  SalesPage,
  SalesQuery,
  UpdateUserInput,
  UserListItem
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

/* ---- Usuarios ---- */

export function listUsuarios(): Promise<UserListItem[]> {
  return api.get<UserListItem[]>('/api/usuarios')
}

export function crearUsuario(input: CreateUserInput): Promise<UserListItem> {
  return api.post<UserListItem>('/api/usuarios', input)
}

export function actualizarUsuario(id: number, input: UpdateUserInput): Promise<UserListItem> {
  return api.put<UserListItem>(`/api/usuarios/${id}`, input)
}

export function desactivarUsuario(id: number): Promise<void> {
  return api.delete<void>(`/api/usuarios/${id}`)
}

/* ---- Historial de ventas ---- */

export function listVentas(query: SalesQuery): Promise<SalesPage> {
  return api.get<SalesPage>('/api/ventas', { query: { ...query } })
}

export function getVentaDetalle(id: number): Promise<SaleWithItems> {
  return api.get<SaleWithItems>(`/api/ventas/${id}`)
}

export function reimprimirTicket(id: number): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/api/ventas/${id}/reimprimir`)
}

/* ---- Cortes de caja ---- */

export function listCortes(query: CashHistoryQuery): Promise<CashSessionListItem[]> {
  return api.get<CashSessionListItem[]>('/api/caja/historial', { query: { ...query } })
}

/* ---- Reportes ---- */

export type ReportParams = { fecha?: string; inicio?: string; mes?: number; anio?: number }

export function getReporte(type: ReportType, params: ReportParams): Promise<SalesReport> {
  return api.get<SalesReport>(`/api/reportes/${type}`, { query: { ...params } })
}

/* ---- Dashboard ---- */

export function getDashboard(): Promise<DashboardData> {
  return api.get<DashboardData>('/api/dashboard')
}
