import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type {
  CreateSaleInput,
  SaleItem,
  SaleWithItems,
  SalesPage,
  SalesQuery
} from '../../shared/types'
import type { DB } from '../db'
import type { SaleItemRow, SaleRow } from '../db/schema'
import { creditAccounts, customers, products, saleItems, sales, users } from '../db/schema'
import { lockOpenSession, withTx } from '../db/tx'
import { HttpError } from '../lib/http-error'
import { fromCents, lineCents, round3, toCents } from '../lib/money'
import { getActiveSession } from './caja'
import { getConfigMap } from './config'

export interface SaleResult extends SaleWithItems {
  creditAccountId?: number
}

/** % de descuento válido (0–100); un valor ausente/ inválido = 100 (sin límite). */
function clampPct(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 100
  return Math.min(100, n)
}

/** Pasa los importes de la fila de venta (centavos) a pesos para la API. */
function saleMoneyToApi(sale: SaleRow): SaleRow {
  return {
    ...sale,
    total: fromCents(sale.total),
    amountPaid: sale.amountPaid == null ? null : fromCents(sale.amountPaid),
    change: sale.change == null ? null : fromCents(sale.change)
  }
}

function itemMoneyToApi(item: SaleItemRow): SaleItem {
  return {
    ...item,
    price: fromCents(item.price),
    originalPrice: item.originalPrice == null ? null : fromCents(item.originalPrice),
    subtotal: fromCents(item.subtotal)
  }
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
 *  - Todo el cálculo de importes es en centavos enteros; se convierte a pesos al responder.
 */
export async function createSale(
  db: DB,
  userId: number,
  input: CreateSaleInput
): Promise<SaleResult> {
  if (input.items.length === 0) {
    throw new HttpError(400, 'La venta no tiene productos.')
  }
  if (input.paymentMethod === 'CREDIT' && input.customerId == null) {
    throw new HttpError(400, 'Elige a qué cliente se le fía.')
  }

  return withTx(db, async (tx) => {
    const session = await getActiveSession(tx, userId)
    if (!session) {
      throw new HttpError(409, 'No hay una caja abierta. Abre caja para vender.')
    }
    // Serializa las ventas de esta sesión de caja (folio + cierre) bajo PostgreSQL.
    if (!(await lockOpenSession(tx, session.id))) {
      throw new HttpError(409, 'La caja se acaba de cerrar. Abre caja para seguir vendiendo.')
    }

    let customerName: string | null = null
    if (input.customerId != null) {
      const [customer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .limit(1)
      if (!customer || customer.active !== 1) {
        throw new HttpError(400, 'El cliente indicado no existe o está inactivo.')
      }
      customerName = customer.name
    }

    // Descuento máximo por línea que el cobrador puede aplicar (config del negocio).
    const maxDiscountPct = clampPct(Number((await getConfigMap(tx))['max_line_discount_pct']))

    const ids = [...new Set(input.items.map((i) => i.productId))]
    const rows = await tx.select().from(products).where(inArray(products.id, ids))
    const byId = new Map(rows.map((r) => [r.id, r]))

    let totalCents = 0
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
      let priceCents = product.price
      if (line.price != null) {
        if (!Number.isFinite(line.price) || line.price <= 0) {
          throw new HttpError(400, `Precio inválido para "${product.name}".`)
        }
        const editedCents = toCents(line.price)
        // El cajero sólo puede aplicar un DESCUENTO sobre el precio de catálogo —
        // nunca cobrar de más, y el precio de catálogo siempre lo pone el servidor.
        if (editedCents > product.price) {
          throw new HttpError(
            400,
            `El precio de "${product.name}" no puede superar el de catálogo.`
          )
        }
        const minAllowedCents = Math.ceil((product.price * (100 - maxDiscountPct)) / 100)
        if (editedCents < minAllowedCents) {
          throw new HttpError(
            400,
            maxDiscountPct === 0
              ? `No está permitido editar el precio de "${product.name}".`
              : `El descuento en "${product.name}" supera el máximo permitido (${maxDiscountPct}%).`
          )
        }
        priceCents = editedCents
      }
      const subtotalCents = lineCents(priceCents, quantity)
      totalCents += subtotalCents
      return {
        productId: product.id,
        name: product.name,
        price: priceCents,
        originalPrice: priceCents < product.price ? product.price : null,
        unit: product.unit,
        quantity,
        subtotal: subtotalCents
      }
    })

    let amountPaidCents: number | null = null
    let changeCents: number | null = null
    let creditAmountCents = 0
    if (input.paymentMethod === 'CASH') {
      const paidCents = input.amountPaid == null ? -1 : toCents(input.amountPaid)
      if (paidCents < totalCents) {
        throw new HttpError(400, 'El monto recibido es menor al total.')
      }
      amountPaidCents = paidCents
      changeCents = paidCents - totalCents
    } else if (input.paymentMethod === 'CREDIT') {
      // Abono inicial (en efectivo) opcional: 0..total. El resto queda a deber.
      const downCents = Math.max(0, toCents(input.amountPaid ?? 0))
      if (downCents >= totalCents) {
        throw new HttpError(
          400,
          'El abono inicial cubre el total: cobra en efectivo, no a crédito.'
        )
      }
      amountPaidCents = downCents || null
      creditAmountCents = totalCents - downCents
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
        total: totalCents,
        paymentMethod: input.paymentMethod,
        amountPaid: amountPaidCents,
        change: changeCents,
        ticketNumber,
        customerId: input.customerId ?? null
      })
      .returning()

    const itemRows: SaleItemRow[] = await tx
      .insert(saleItems)
      .values(lines.map((line) => ({ saleId: sale.id, ...line })))
      .returning()

    let creditAccountId: number | undefined
    if (input.paymentMethod === 'CREDIT') {
      const [account] = await tx
        .insert(creditAccounts)
        .values({
          saleId: sale.id,
          customerId: input.customerId!,
          userId,
          total: creditAmountCents,
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

    return {
      ...saleMoneyToApi(sale),
      items: itemRows.map(itemMoneyToApi),
      userName: user?.username ?? '',
      customerName,
      creditAccountId
    }
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
        itemCount: sql<number>`(select coalesce(count(*), 0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`
      })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.userId))
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .where(where)
      .orderBy(desc(sales.createdAt), desc(sales.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ).map((r) => ({
    ...r,
    total: fromCents(Number(r.total)),
    amountPaid: r.amountPaid == null ? null : fromCents(Number(r.amountPaid)),
    change: r.change == null ? null : fromCents(Number(r.change)),
    itemCount: Number(r.itemCount)
  }))

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

  return {
    ...saleMoneyToApi(sale),
    items: items.map(itemMoneyToApi),
    userName: user?.username ?? '',
    customerName
  }
}
