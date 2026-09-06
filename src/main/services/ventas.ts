import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { CreateSaleInput, SaleWithItems, SalesPage, SalesQuery } from '../../shared/types'
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

const MAX_PAGE_SIZE = 100

/** Historial de ventas paginado con filtros (panel de administración). */
export function listSales(db: DB, query: SalesQuery): SalesPage {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? 50))

  const conditions = [
    query.from != null ? gte(sales.createdAt, query.from) : undefined,
    query.to != null ? lte(sales.createdAt, query.to) : undefined,
    query.userId != null ? eq(sales.userId, query.userId) : undefined,
    query.paymentMethod ? eq(sales.paymentMethod, query.paymentMethod) : undefined
  ].filter(Boolean)
  const where = conditions.length ? and(...conditions) : undefined

  const [{ total }] = db.select({ total: count() }).from(sales).where(where).all()

  const rows = db
    .select({
      id: sales.id,
      ticketNumber: sales.ticketNumber,
      cashSessionId: sales.cashSessionId,
      userId: sales.userId,
      userName: users.username,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      amountPaid: sales.amountPaid,
      change: sales.change,
      createdAt: sales.createdAt,
      itemCount: sql<number>`(select coalesce(sum(${saleItems.quantity}), 0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.userId))
    .where(where)
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { rows, total, page, pageSize }
}

/** Carga una venta con sus líneas y el nombre del cobrador (para reimpresión). */
export function getSaleWithItems(db: DB, saleId: number): SaleWithItems {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()
  if (!sale) throw new HttpError(404, 'Venta no encontrada.')

  const items = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()
  const user = db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, sale.userId))
    .get()

  return { ...sale, items, userName: user?.username ?? '' }
}
