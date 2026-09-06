/**
 * Tipos compartidos entre el Main Process (Fastify + Drizzle) y el Renderer (React).
 * Todo lo que cruce la frontera HTTP vive aquí para mantener un solo contrato.
 */

export type Role = 'ADMIN' | 'COBRADOR'
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER'
export type CashSessionStatus = 'OPEN' | 'CLOSED'
export type LicenseStatus = 'ACTIVE' | 'REVOKED'

export interface AuthUser {
  id: number
  username: string
  role: Role
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface Category {
  id: number
  name: string
  active: number
}

export interface Product {
  id: number
  name: string
  price: number
  categoryId: number | null
  imagePath: string | null
  active: number
  createdAt: number
  updatedAt: number
}

export interface CashSession {
  id: number
  userId: number
  openedAt: number
  closedAt: number | null
  openingAmount: number
  closingAmount: number | null
  expectedAmount: number | null
  difference: number | null
  status: CashSessionStatus
}

export interface Sale {
  id: number
  cashSessionId: number
  userId: number
  total: number
  paymentMethod: PaymentMethod
  amountPaid: number | null
  change: number | null
  ticketNumber: number
  createdAt: number
}

export interface SaleItem {
  id: number
  saleId: number
  productId: number
  name: string
  price: number
  quantity: number
  subtotal: number
}

/** Producto con el nombre de su categoría resuelto (respuesta de `GET /api/productos`). */
export interface ProductWithCategory extends Product {
  categoryName: string | null
}

/** Línea del carrito que el cliente envía. El precio SIEMPRE lo pone el servidor. */
export interface CartLineInput {
  productId: number
  quantity: number
}

/** Cuerpo de `POST /api/ventas`. */
export interface CreateSaleInput {
  items: CartLineInput[]
  paymentMethod: PaymentMethod
  /** Requerido y >= total cuando `paymentMethod === 'CASH'`. */
  amountPaid?: number
}

/** Cuerpo de `POST /api/caja/apertura`. */
export interface OpenCashSessionInput {
  openingAmount: number
}

/** Cuerpo de `POST /api/caja/cierre`. */
export interface CloseCashSessionInput {
  /** Efectivo final contado por el cobrador. */
  closingAmount: number
}

export interface SaleWithItems extends Sale {
  items: SaleItem[]
  userName: string
}

/** Resultado de intentar imprimir un ticket. Nunca hace fallar la venta. */
export interface PrintResult {
  printed: boolean
  error?: string
}

/** Respuesta de `POST /api/ventas` — la venta más el estado de impresión. */
export interface CreateSaleResponse extends SaleWithItems {
  print: PrintResult
}

/** Resumen del turno actual (para la pantalla de cierre de caja). */
export interface CashSessionSummary {
  session: CashSession
  salesCount: number
  totalAll: number
  totalCash: number
  totalCard: number
  totalTransfer: number
  /** Efectivo esperado en caja = apertura + ventas en efectivo. */
  expectedCash: number
}

export interface BusinessConfig {
  business_name: string
  business_address?: string
  business_phone?: string
  logo_path?: string
  ticket_footer?: string
  currency_symbol: string
}

/** Estado de la licencia (Sprint 1). `/api/licencia/estado`. */
export interface LicenseStatusResponse {
  active: boolean
  /** SHA-256 del hardware de este equipo. Se muestra en la pantalla de activación. */
  fingerprint: string
  activatedAt: number | null
}

/** Respuesta del endpoint de diagnóstico /api/ping (Sprint 0). */
export interface PingResponse {
  ok: true
  service: 'pos-spartan-tech'
  phase: 1
  now: number
  db: 'connected' | 'error'
  version: string
}

/** Envoltura de error homogénea para todos los endpoints. */
export interface ApiError {
  error: string
  details?: unknown
}
