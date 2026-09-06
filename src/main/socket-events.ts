/**
 * Eventos que el servidor emite por Socket.io.
 *
 * Regla: Socket.io SÓLO notifica, nunca ejecuta lógica. El cliente que recibe
 * un evento hace `fetch()` si necesita datos frescos.
 *
 * Fase 1: se emiten al Renderer del mismo Electron.
 * Fase 2: se emiten a todas las tabletas/laptops conectadas. El código no cambia.
 */
export const EVENTS = {
  VENTA_NUEVA: 'venta:nueva', // { saleId, total, userId, cashSessionId }
  CAJA_APERTURA: 'caja:apertura', // { cashSessionId, userId, openingAmount }
  CAJA_CIERRE: 'caja:cierre', // { cashSessionId, userId, total, difference }
  PRODUCTO_UPDATE: 'producto:update', // { productId }
  CUENTA_ABONO: 'cuenta:abono', // { creditAccountId, customerId, balance, settled }
  STOCK_UPDATE: 'stock:update' // reservado para Fase 3 (inventario)
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

export interface EventPayloads {
  'venta:nueva': { saleId: number; total: number; userId: number; cashSessionId: number }
  'caja:apertura': { cashSessionId: number; userId: number; openingAmount: number }
  'caja:cierre': { cashSessionId: number; userId: number; total: number; difference: number }
  'producto:update': { productId: number }
  'cuenta:abono': {
    creditAccountId: number
    customerId: number
    balance: number
    settled: boolean
  }
  'stock:update': { productId: number }
}
