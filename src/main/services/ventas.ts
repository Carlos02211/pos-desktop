import { eq, inArray, sql } from 'drizzle-orm'
import type { CreateSaleInput, SaleWithItems } from '../../shared/types'
import type { DB } from '../db'
import { products, saleItems, sales, users } from '../db/schema'
import { HttpError } from '../lib/http-error'
import { round2 } from '../lib/money'
import { getActiveSession } from './caja'

/**
 * Registra una venta y sus líneas en una transacción.
 *
 * Reglas de desarrollo aplicadas:
 *  - No se puede vender sin caja abierta.
 *  - El precio y el nombre se toman de la BD (snapshot en `sale_items`), nunca del cliente.
 *  - `ticketNumber` es un folio secuencial por sesión de caja.
 */
export function createSale(db: DB, userId: number, input: CreateSaleInput): SaleWithItems {
  const session = getActiveSession(db, userId)
  if (!session) {
    throw new HttpError(409, 'No hay una caja abierta. Abre caja para vender.')
  }
  if (input.items.length === 0) {
    throw new HttpError(400, 'La venta no tiene productos.')
  }

  return db.transaction((tx) => {
    const ids = [...new Set(input.items.map((i) => i.productId))]
    const rows = tx.select().from(products).where(inArray(products.id, ids)).all()
    const byId = new Map(rows.map((r) => [r.id, r]))

    let total = 0
    const lines = input.items.map((line) => {
      const product = byId.get(line.productId)
      if (!product || product.active !== 1) {
        throw new HttpError(400, `Producto no disponible (id ${line.productId}).`)
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new HttpError(400, `Cantidad inválida para "${product.name}".`)
      }
      const subtotal = round2(product.price * line.quantity)
      total = round2(total + subtotal)
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: line.quantity,
        subtotal
      }
    })

    let amountPaid: number | null = null
    let change: number | null = null
    if (input.paymentMethod === 'CASH') {
      if (input.amountPaid == null || input.amountPaid < total) {
        throw new HttpError(400, 'El monto recibido es menor al total.')
      }
      amountPaid = round2(input.amountPaid)
      change = round2(amountPaid - total)
    }

    const last = tx
      .select({ max: sql<number>`coalesce(max(${sales.ticketNumber}), 0)` })
      .from(sales)
      .where(eq(sales.cashSessionId, session.id))
      .get()
    const ticketNumber = (last?.max ?? 0) + 1

    const [sale] = tx
      .insert(sales)
      .values({
        cashSessionId: session.id,
        userId,
        total,
        paymentMethod: input.paymentMethod,
        amountPaid,
        change,
        ticketNumber
      })
      .returning()
      .all()

    const items = lines.map((line) => {
      const [item] = tx
        .insert(saleItems)
        .values({ saleId: sale.id, ...line })
        .returning()
        .all()
      return item
    })

    const user = tx
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .get()

    return { ...sale, items, userName: user?.username ?? '' }
  })
}
