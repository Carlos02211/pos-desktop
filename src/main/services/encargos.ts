import { asc, desc, eq, ne } from 'drizzle-orm'
import type {
  CancelOrderInput,
  CartLineInput,
  CreateOrderInput,
  Order,
  OrderItem,
  OrderStatus,
  SaleWithItems
} from '../../shared/types'
import type { DB } from '../db'
import type { OrderRow } from '../db/schema'
import { cashMovements, orders, users } from '../db/schema'
import { lockRow, withTx } from '../db/tx'
import { HttpError } from '../lib/http-error'
import { fromCents, toCents } from '../lib/money'
import {
  buildLines,
  depositProductId,
  recordSale,
  requireOpenSession,
  type SaleActor
} from './ventas'

/**
 * Encargos ("apártame 2 pollos para las 2"). El pedido guarda lo que lleva; si dejan anticipo
 * se cobra en ese momento como una venta aparte (producto interno ANTICIPO). Al entregarlo se
 * cobra con `POST /api/ventas` + `orderId`, que descuenta el anticipo con un renglón negativo.
 * Así cada peso entra a la caja del turno en que se recibió y cortes y reportes cuadran solos.
 */

/** Encargos cerrados que se muestran además de los pendientes (para consultar los de hoy). */
const CLOSED_LIMIT = 50

function toApi(row: OrderRow, userName: string): Order {
  return {
    id: row.id,
    customerName: row.customerName,
    phone: row.phone,
    pickupAt: row.pickupAt,
    notes: row.notes,
    items: JSON.parse(row.items) as OrderItem[],
    total: fromCents(row.total),
    deposit: fromCents(row.deposit),
    depositSaleId: row.depositSaleId,
    status: row.status,
    saleId: row.saleId,
    userId: row.userId,
    userName,
    createdAt: row.createdAt,
    closedAt: row.closedAt
  }
}

/** Pendientes (el más próximo primero) o los ya cerrados (el más reciente primero). */
export async function listOrders(db: DB, status: 'PENDING' | 'CLOSED'): Promise<Order[]> {
  const base = db
    .select({ order: orders, userName: users.username })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
  const rows =
    status === 'PENDING'
      ? await base.where(eq(orders.status, 'PENDING')).orderBy(asc(orders.pickupAt), asc(orders.id))
      : await base
          .where(ne(orders.status, 'PENDING'))
          .orderBy(desc(orders.closedAt), desc(orders.id))
          .limit(CLOSED_LIMIT)
  return rows.map((r) => toApi(r.order, r.userName))
}

export async function getOrder(db: DB, id: number): Promise<Order> {
  const [row] = await db
    .select({ order: orders, userName: users.username })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, id))
    .limit(1)
  if (!row) throw new HttpError(404, 'Encargo no encontrado.')
  return toApi(row.order, row.userName)
}

/** Encargo cuyo anticipo se cobró con esta venta (para reimprimir su comprobante). */
export async function orderForDepositSale(db: DB, saleId: number): Promise<Order | undefined> {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.depositSaleId, saleId))
    .limit(1)
  return row ? getOrder(db, row.id) : undefined
}

function cleanText(text: string | undefined): string | null {
  const clean = text?.trim().replace(/\s+/g, ' ')
  return clean ? clean : null
}

/** Una hora de margen: anotar a las 2:05 uno que pasaron a recoger a las 2 sigue valiendo. */
const PAST_GRACE_S = 60 * 60

export async function createOrder(
  db: DB,
  userId: number,
  input: CreateOrderInput
): Promise<{ order: Order; depositSale: SaleWithItems | null }> {
  const customerName = cleanText(input.customerName)
  if (!customerName) throw new HttpError(400, 'Escribe a nombre de quién es el encargo.')
  if (input.items.length === 0) throw new HttpError(400, 'El encargo no tiene productos.')
  if (input.pickupAt < Math.floor(Date.now() / 1000) - PAST_GRACE_S) {
    throw new HttpError(400, 'La hora en que pasan por él ya pasó: revisa el día y la hora.')
  }

  return withTx(db, async (tx) => {
    // Mismas reglas que una venta (producto activo, opciones, descuento máximo).
    const { lines, totalCents } = await buildLines(tx, input.items)
    const depositCents = toCents(input.deposit ?? 0)
    if (depositCents < 0) throw new HttpError(400, 'El anticipo no puede ser negativo.')
    if (depositCents > totalCents) {
      throw new HttpError(400, 'El anticipo no puede ser mayor que el total del encargo.')
    }
    if (depositCents > 0 && !input.depositMethod) {
      throw new HttpError(400, 'Indica cómo pagaron el anticipo.')
    }
    // Sin caja abierta no se puede recibir dinero: se revisa antes de guardar nada.
    const session = depositCents > 0 ? await requireOpenSession(tx, userId) : null

    const items: OrderItem[] = input.items.map((line: CartLineInput, i) => ({
      productId: line.productId,
      quantity: lines[i].quantity,
      ...(line.price != null ? { price: line.price } : {}),
      ...(line.note?.trim() ? { note: line.note.trim().replace(/\s+/g, ' ') } : {}),
      ...(line.optionIds?.length ? { optionIds: line.optionIds } : {}),
      // Precio libre: la descripción ya va en el nombre ("Varios - Salsa extra").
      name: lines[i].name,
      unit: lines[i].unit,
      unitPrice: fromCents(lines[i].price),
      subtotal: fromCents(lines[i].subtotal)
    }))

    const [row] = await tx
      .insert(orders)
      .values({
        customerName,
        phone: cleanText(input.phone),
        pickupAt: input.pickupAt,
        notes: cleanText(input.notes),
        items: JSON.stringify(items),
        total: totalCents,
        deposit: depositCents,
        userId
      })
      .returning()

    let depositSale: SaleWithItems | null = null
    if (session) {
      depositSale = await recordSale(
        tx,
        userId,
        session,
        { paymentMethod: input.depositMethod!, amountPaid: input.amountPaid },
        [
          {
            productId: await depositProductId(tx),
            name: `Anticipo del encargo #${row.id} - ${customerName}`,
            price: depositCents,
            originalPrice: null,
            unit: 'PIEZA',
            quantity: 1,
            subtotal: depositCents,
            note: null
          }
        ],
        depositCents
      )
      await tx.update(orders).set({ depositSaleId: depositSale.id }).where(eq(orders.id, row.id))
    }
    return { order: await getOrder(tx, row.id), depositSale }
  })
}

/**
 * Cancela un encargo pendiente. Si dejaron anticipo y se les regresa (`refund`), sale de la
 * caja del que cancela como retiro de efectivo, para que el corte cuadre.
 */
export async function cancelOrder(
  db: DB,
  actor: SaleActor,
  id: number,
  input: CancelOrderInput
): Promise<Order> {
  return withTx(db, async (tx) => {
    await lockRow(tx, 'orders', id)
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1)
    if (!order) throw new HttpError(404, 'Encargo no encontrado.')
    if (order.status !== 'PENDING') {
      throw new HttpError(409, statusMessage(order.id, order.status))
    }
    if (input.refund && order.deposit > 0) {
      const session = await requireOpenSession(tx, actor.id)
      await tx.insert(cashMovements).values({
        cashSessionId: session.id,
        userId: actor.id,
        type: 'OUT',
        amount: order.deposit,
        reason: `Devolución del anticipo del encargo #${order.id} (${order.customerName})`
      })
    }
    await tx
      .update(orders)
      .set({ status: 'CANCELLED', closedAt: Math.floor(Date.now() / 1000) })
      .where(eq(orders.id, id))
    return getOrder(tx, id)
  })
}

export function statusMessage(id: number, status: OrderStatus): string {
  return status === 'DELIVERED'
    ? `El encargo #${id} ya se entregó.`
    : status === 'CANCELLED'
      ? `El encargo #${id} está cancelado.`
      : `El encargo #${id} sigue pendiente.`
}
