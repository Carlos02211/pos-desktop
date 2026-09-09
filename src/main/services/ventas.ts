import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { CreateSaleInput, SaleWithItems, SalesPage, SalesQuery } from '../../shared/types'
import type { DB } from '../db'
import type { SaleItemRow } from '../db/schema'
import { creditAccounts, customers, products, saleItems, sales, users } from '../db/schema'
import { withTx } from '../db/tx'
import { HttpError } from '../lib/http-error'
import { round2, round3 } from '../lib/money'
import { getActiveSession } from './caja'

export interface SaleResult extends SaleWithItems {
  creditAccountId?: number
}

/**
 * Registra una venta y sus líneas en una transacción.
 *
 * Reglas de desarrollo aplicadas:
 *  - No se puede vender sin caja abierta.
 *  - El nombre siempre se toma de la BD. El precio también, salvo que el cajero lo edite en el
 *    momento (ej. descuento a un cliente frecuente) — en ese caso se guarda el precio de catálogo
 *    en `originalPrice` para dejar rastro de qué se cobró y qué costaba el producto.
 *  - `ticketNumber` es un folio secuencial por sesión de caja.
 */
export async function createSale(
  db: DB,
  userId: number,
  input: CreateSaleInput
): Promise<SaleResult> {
  const session = await getActiveSession(db, userId)
  if (!session) {
    throw new HttpError(409, 'No hay una caja abierta. Abre caja para vender.')
  }
  if (input.items.length === 0) {
    throw new HttpError(400, 'La venta no tiene productos.')
  }
  if (input.paymentMethod === 'CREDIT' && input.customerId == null) {
    throw new HttpError(400, 'Elige a qué cliente se le fía.')
  }
  let customerName: string | null = null
  if (input.customerId != null) {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1)
    if (!customer || customer.active !== 1) {
      throw new HttpError(400, 'El cliente indicado no existe o está inactivo.')
    }
    customerName = customer.name
  }

  return withTx(db, async (tx) => {
    const ids = [...new Set(input.items.map((i) => i.productId))]
    const rows = await tx.select().from(products).where(inArray(products.id, ids))
    const byId = new Map(rows.map((r) => [r.id, r]))

    let total = 0
    const lines = input.items.map((line) => {
      const product = byId.get(line.productId)
      if (!product || product.active !== 1) {
        throw new HttpError(400, `Producto no disponible (id ${line.productId}).`)
      }
      let quantity: number
      if (product.unit === 'KG') {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
          throw new HttpError(400, `Cantidad inválida para "${product.name}".`)
        }
        quantity = round3(line.quantity) // precisión de 1 gramo
      } else {
        if (!Number.isInteger(line.quantity) || line.quantity < 1) {
          throw new HttpError(400, `Cantidad inválida para "${product.name}".`)
        }
        quantity = line.quantity
      }
      let price = product.price
      if (line.price != null) {
        if (!Number.isFinite(line.price) || line.price <= 0) {
          throw new HttpError(400, `Precio inválido para "${product.name}".`)
        }
        const edited = round2(line.price)
        // El cajero sólo puede aplicar un DESCUENTO sobre el precio de catálogo —
        // nunca cobrar de más, y el precio de catálogo siempre lo pone el servidor.
        if (edited > round2(product.price)) {
          throw new HttpError(
            400,
            `El precio de "${product.name}" no puede superar el de catálogo.`
          )
        }
        price = edited
      }
      const subtotal = round2(price * quantity)
      total = round2(total + subtotal)
      return {
        productId: product.id,
        name: product.name,
        price,
        originalPrice: price < round2(product.price) ? round2(product.price) : null,
        unit: product.unit,
        quantity,
        subtotal
      }
    })

    let amountPaid: number | null = null
    let change: number | null = null
    let creditAmount = 0
    if (input.paymentMethod === 'CASH') {
      if (input.amountPaid == null || input.amountPaid < total) {
        throw new HttpError(400, 'El monto recibido es menor al total.')
      }
      amountPaid = round2(input.amountPaid)
      change = round2(amountPaid - total)
    } else if (input.paymentMethod === 'CREDIT') {
      // Abono inicial (en efectivo) opcional: 0..total. El resto queda a deber.
      const down = round2(Math.max(0, input.amountPaid ?? 0))
      if (down >= total) {
        throw new HttpError(
          400,
          'El abono inicial cubre el total: cobra en efectivo, no a crédito.'
        )
      }
      amountPaid = down || null
      creditAmount = round2(total - down)
    }

    const [last] = await tx
      .select({ max: sql<number>`coalesce(max(${sales.ticketNumber}), 0)` })
      .from(sales)
      .where(eq(sales.cashSessionId, session.id))
    const ticketNumber = Number(last?.max ?? 0) + 1

    const [sale] = await tx
      .insert(sales)
      .values({
        cashSessionId: session.id,
        userId,
        total,
        paymentMethod: input.paymentMethod,
        amountPaid,
        change,
        ticketNumber,
        customerId: input.customerId ?? null
      })
      .returning()

    const items: SaleItemRow[] = []
    for (const line of lines) {
      const [item] = await tx
        .insert(saleItems)
        .values({ saleId: sale.id, ...line })
        .returning()
      items.push(item)
    }

    let creditAccountId: number | undefined
    if (input.paymentMethod === 'CREDIT') {
      const [account] = await tx
        .insert(creditAccounts)
        .values({
          saleId: sale.id,
          customerId: input.customerId!,
          userId,
          total: creditAmount,
          paid: 0,
          status: 'OPEN'
        })
        .returning()
      creditAccountId = account.id
    }

    const [user] = await tx
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    return { ...sale, items, userName: user?.username ?? '', customerName, creditAccountId }
  })
}

const MAX_PAGE_SIZE = 100

/** Historial de ventas paginado con filtros (panel de administración). */
export async function listSales(db: DB, query: SalesQuery): Promise<SalesPage> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? 50))

  const conditions = [
    query.from != null ? gte(sales.createdAt, query.from) : undefined,
    query.to != null ? lte(sales.createdAt, query.to) : undefined,
    query.userId != null ? eq(sales.userId, query.userId) : undefined,
    query.paymentMethod ? eq(sales.paymentMethod, query.paymentMethod) : undefined
  ].filter(Boolean)
  const where = conditions.length ? and(...conditions) : undefined

  const [{ total }] = await db.select({ total: count() }).from(sales).where(where)

  const rows = (
    await db
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
        customerName: customers.name,
        createdAt: sales.createdAt,
        itemCount: sql<number>`(select coalesce(sum(${saleItems.quantity}), 0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`
      })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.userId))
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .where(where)
      .orderBy(desc(sales.createdAt), desc(sales.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ).map((r) => ({ ...r, itemCount: Number(r.itemCount) }))

  return { rows, total: Number(total), page, pageSize }
}

/** Carga una venta con sus líneas y el nombre del cobrador (para reimpresión). */
export async function getSaleWithItems(db: DB, saleId: number): Promise<SaleWithItems> {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1)
  if (!sale) throw new HttpError(404, 'Venta no encontrada.')

  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId))
  const [user] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, sale.userId))
    .limit(1)

  let customerName: string | null = null
  if (sale.customerId != null) {
    const [customer] = await db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, sale.customerId))
      .limit(1)
    customerName = customer?.name ?? null
  }

  return { ...sale, items, userName: user?.username ?? '', customerName }
}
