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

export interface SaleWithItems extends Sale {
  items: SaleItem[]
  userName: string
}

export interface BusinessConfig {
  business_name: string
  business_address?: string
  business_phone?: string
  logo_path?: string
  ticket_footer?: string
  currency_symbol: string
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
