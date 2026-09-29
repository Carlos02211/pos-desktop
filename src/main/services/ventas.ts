import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type {
  AddToSaleInput,
  CreateSaleInput,
  Role,
  SaleItem,
  SaleWithItems,
  SalesPage,
  SalesQuery,
  TurnSale
} from '../../shared/types'
import type { DB } from '../db'
import type { SaleItemRow, SaleRow } from '../db/schema'
import {
  cashSessions,
  creditAccounts,
  customers,
  products,
  saleItems,
  sales,
  users
} from '../db/schema'
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

    const { lines, totalCents } = await buildLines(tx, input.items)

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

type NewSaleLine = Omit<SaleItemRow, 'id' | 'saleId' | 'addedAt'>

/**
 * Valida las líneas del carrito contra el catálogo y calcula los importes en centavos.
 * El nombre y el precio de catálogo siempre salen de la BD; el cajero sólo puede aplicar un
 * descuento dentro del máximo configurado. La usan la venta nueva y "agregar a una venta".
 */
async function buildLines(
  tx: DB,
  items: CreateSaleInput['items']
): Promise<{ lines: NewSaleLine[]; totalCents: number }> {
  // Descuento máximo por línea que el cobrador puede aplicar (config del negocio).
  const maxDiscountPct = clampPct(Number((await getConfigMap(tx))['max_line_discount_pct']))

  const ids = [...new Set(items.map((i) => i.productId))]
  const rows = await tx.select().from(products).where(inArray(products.id, ids))
  const byId = new Map(rows.map((r) => [r.id, r]))

  let totalCents = 0
  const lines = items.map((line): NewSaleLine => {
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
        throw new HttpError(400, `El precio de "${product.name}" no puede superar el de catálogo.`)
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
  return { lines, totalCents }
}

/**
 * Artículos de una venta: las piezas cuentan por su cantidad y cada producto por peso (kg)
 * cuenta como 1 (0.350 kg de aguacate es "un artículo", no 0.35). Misma regla que el carrito.
 */
export const saleItemCountSql = sql<number>`(select coalesce(sum(case when ${saleItems.unit} = 'KG' then 1 else ${saleItems.quantity} end), 0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`

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
        itemCount: saleItemCountSql
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

/** Quien hace la operación: el cobrador sólo actúa sobre su propia caja; el admin, sobre cualquiera. */
export interface SaleActor {
  id: number
  role: Role
}

export interface AddToSaleResult extends SaleResult {
  addedTotal: number
  addedChange: number | null
  /** Si la venta es fiada: saldo de la cuenta después de sumar lo agregado. */
  credit?: { accountId: number; customerId: number; balance: number }
}

const CLOSED_SESSION_MSG = 'Esa venta es de una caja ya cerrada: registra una venta nueva.'

/**
 * Productos que el cliente olvidó: se suman a una venta ya cobrada del turno ABIERTO, con el
 * mismo folio, y se cobran con el mismo método de pago. Sólo se agrega (nunca se quita), así
 * que no puede sacar dinero de la caja. Los cortes, el dashboard y los reportes suman
 * `sales.total` por método, así que cuadran sin cambios.
 *
 *  - CASH: `amountPaid` es lo recibido por lo agregado; se acumula en la venta con su cambio.
 *  - CREDIT: lo agregado se suma a la deuda de la cuenta (se reabre si ya estaba pagada).
 *  - CARD / TRANSFER: se cobra lo agregado por el mismo medio.
 */
export async function addToSale(
  db: DB,
  actor: SaleActor,
  saleId: number,
  input: AddToSaleInput
): Promise<AddToSaleResult> {
  if (input.items.length === 0) {
    throw new HttpError(400, 'No hay productos para agregar.')
  }

  return withTx(db, async (tx) => {
    const [found] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1)
    if (!found) throw new HttpError(404, 'Venta no encontrada.')
    const [session] = await tx
      .select()
      .from(cashSessions)
      .where(eq(cashSessions.id, found.cashSessionId))
      .limit(1)
    if (!session || session.status !== 'OPEN') throw new HttpError(409, CLOSED_SESSION_MSG)
    if (actor.role !== 'ADMIN' && session.userId !== actor.id) {
      throw new HttpError(403, 'Sólo puedes completar ventas de tu propia caja.')
    }
    // Serializa con el cierre y con otras ventas de la caja; relee la venta ya bloqueada.
    if (!(await lockOpenSession(tx, session.id))) throw new HttpError(409, CLOSED_SESSION_MSG)
    const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1)

    const { lines, totalCents: addedCents } = await buildLines(tx, input.items)

    let amountPaidCents = sale.amountPaid
    let changeCents = sale.change
    let addedChangeCents: number | null = null
    if (sale.paymentMethod === 'CASH') {
      const paidCents = input.amountPaid == null ? -1 : toCents(input.amountPaid)
      if (paidCents < addedCents) {
        throw new HttpError(400, 'El monto recibido es menor a lo que se agrega.')
      }
      addedChangeCents = paidCents - addedCents
      amountPaidCents = (sale.amountPaid ?? sale.total) + paidCents
      changeCents = (sale.change ?? 0) + addedChangeCents
    }

    let credit: AddToSaleResult['credit']
    if (sale.paymentMethod === 'CREDIT') {
      const [account] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.saleId, sale.id))
        .limit(1)
      if (!account) throw new HttpError(409, 'La venta fiada no tiene cuenta por cobrar.')
      const newTotal = account.total + addedCents
      await tx
        .update(creditAccounts)
        .set({ total: newTotal, status: 'OPEN', closedAt: null })
        .where(eq(creditAccounts.id, account.id))
      credit = {
        accountId: account.id,
        customerId: account.customerId,
        balance: fromCents(newTotal - account.paid)
      }
    }

    await tx
      .update(sales)
      .set({ total: sale.total + addedCents, amountPaid: amountPaidCents, change: changeCents })
      .where(eq(sales.id, sale.id))

    const addedAt = Math.floor(Date.now() / 1000)
    await tx.insert(saleItems).values(lines.map((line) => ({ saleId: sale.id, addedAt, ...line })))

    const full = await getSaleWithItems(tx, sale.id)
    return {
      ...full,
      creditAccountId: credit?.accountId,
      addedTotal: fromCents(addedCents),
      addedChange: addedChangeCents == null ? null : fromCents(addedChangeCents),
      credit
    }
  })
}

/**
 * Ventas del turno abierto, de la más nueva a la más vieja. El cobrador ve las de su caja; el
 * admin, las de todas las cajas abiertas. `canReprint`: el cobrador sólo reimprime la última.
 */
export async function listTurnSales(db: DB, actor: SaleActor): Promise<TurnSale[]> {
  const open = await db
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      actor.role === 'ADMIN'
        ? eq(cashSessions.status, 'OPEN')
        : and(eq(cashSessions.status, 'OPEN'), eq(cashSessions.userId, actor.id))
    )
  if (open.length === 0) return []
  const sessionIds = open.map((s) => s.id)

  const rows = await db
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
      itemCount: saleItemCountSql
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.userId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(inArray(sales.cashSessionId, sessionIds))
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(200)

  // Folio más alto de cada caja = su última venta.
  const lastBySession = new Map<number, number>()
  for (const r of rows) {
    lastBySession.set(
      r.cashSessionId,
      Math.max(lastBySession.get(r.cashSessionId) ?? 0, r.ticketNumber)
    )
  }

  return rows.map((r) => ({
    ...r,
    total: fromCents(Number(r.total)),
    amountPaid: r.amountPaid == null ? null : fromCents(Number(r.amountPaid)),
    change: r.change == null ? null : fromCents(Number(r.change)),
    itemCount: Number(r.itemCount),
    canReprint: actor.role === 'ADMIN' || r.ticketNumber === lastBySession.get(r.cashSessionId)
  }))
}

/**
 * El admin reimprime cualquier ticket. El cobrador, sólo el ÚLTIMO de su caja abierta (se
 * acabó el papel, se atoró el ticket): así no puede sacar copias de ventas viejas.
 */
export async function assertCanReprint(db: DB, actor: SaleActor, saleId: number): Promise<void> {
  if (actor.role === 'ADMIN') return
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1)
  if (!sale) throw new HttpError(404, 'Venta no encontrada.')
  const session = await getActiveSession(db, actor.id)
  const [last] = session
    ? await db
        .select({ max: sql<number>`coalesce(max(${sales.ticketNumber}), 0)` })
        .from(sales)
        .where(eq(sales.cashSessionId, session.id))
    : []
  if (
    !session ||
    sale.cashSessionId !== session.id ||
    sale.ticketNumber !== Number(last?.max ?? 0)
  ) {
    throw new HttpError(
      403,
      'Sólo puedes reimprimir el último ticket de tu caja. Los anteriores, pídelos al administrador.'
    )
  }
}
