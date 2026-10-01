import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { getConfigMap } from '../services/config'
import { cancelOrder, createOrder, getOrder, listOrders } from '../services/encargos'
import { openCashDrawerInBackground, printOrderTicket, printTicket } from '../services/printer'
import { getSaleWithItems } from '../services/ventas'
import { saleLinesSchema } from './ventas'

const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).optional(),
  pickupAt: z.number().int().positive(),
  notes: z.string().trim().max(200).optional(),
  items: saleLinesSchema,
  deposit: z.number().nonnegative().max(1_000_000).optional(),
  depositMethod: z.enum(['CASH', 'CARD', 'TRANSFER']).optional(),
  amountPaid: z.number().nonnegative().max(1_000_000).optional(),
  clientRequestId: z.string().min(8).max(64).optional()
})

const listQuery = z.object({ status: z.enum(['PENDING', 'CLOSED']).optional() })
const cancelSchema = z.object({ refund: z.boolean().optional() })
const idParam = z.object({ id: z.coerce.number().int().positive() })

/** Mismo dedup que las ventas: un doble clic no debe guardar (ni cobrar) dos encargos. */
const IDEMPOTENCY_TTL_MS = 5 * 60_000
const recentOrders = new Map<string, { orderId: Promise<number>; at: number }>()

export async function encargosRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/encargos', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const { status } = parse(listQuery, request.query)
    return listOrders(getDb(), status ?? 'PENDING')
  })

  app.post('/api/encargos', { preHandler: requireRole('COBRADOR') }, async (request, reply) => {
    const input = parse(createOrderSchema, request.body)
    const db = getDb()
    const userId = request.authUser!.id

    const key = input.clientRequestId ? `${userId}:${input.clientRequestId}` : null
    if (key) {
      const prev = recentOrders.get(key)
      if (prev && Date.now() - prev.at <= IDEMPOTENCY_TTL_MS) {
        const order = await getOrder(db, await prev.orderId)
        const depositSale =
          order.depositSaleId != null ? await getSaleWithItems(db, order.depositSaleId) : null
        return reply.code(200).send({ order, depositSale, print: { printed: false } })
      }
    }

    const pending = createOrder(db, userId, input)
    if (key) {
      const now = Date.now()
      for (const [k, v] of recentOrders) if (now - v.at > IDEMPOTENCY_TTL_MS) recentOrders.delete(k)
      const entry = { orderId: pending.then((r) => r.order.id), at: now }
      recentOrders.set(key, entry)
      entry.orderId.catch(() => {
        if (recentOrders.get(key) === entry) recentOrders.delete(key)
      })
    }
    const { order, depositSale } = await pending

    emit('encargo:update', { orderId: order.id, status: order.status })
    if (depositSale) {
      emit('venta:nueva', {
        saleId: depositSale.id,
        total: depositSale.total,
        userId,
        cashSessionId: depositSale.cashSessionId
      })
    }

    // Comprobante: con anticipo es el ticket de esa venta (abre el cajón si fue en efectivo).
    const config = await getConfigMap(db)
    const print = depositSale
      ? await printTicket(depositSale, config, { openDrawer: true, order })
      : await printOrderTicket(order, config)
    if (!print.printed && !print.skipped)
      request.log.warn({ err: print.error }, 'encargo no impreso')

    return reply.code(201).send({ order, depositSale, print })
  })

  // Reimprimir el comprobante del encargo (se perdió, o lo pide la cocina).
  app.post(
    '/api/encargos/:id/imprimir',
    { preHandler: requireRole('COBRADOR') },
    async (request) => {
      const { id } = parse(idParam, request.params)
      const db = getDb()
      return printOrderTicket(await getOrder(db, id), await getConfigMap(db))
    }
  )

  app.post(
    '/api/encargos/:id/cancelar',
    { preHandler: requireRole('COBRADOR') },
    async (request) => {
      const { id } = parse(idParam, request.params)
      const input = parse(cancelSchema, request.body ?? {})
      const db = getDb()
      const order = await cancelOrder(db, request.authUser!, id, input)
      emit('encargo:update', { orderId: order.id, status: order.status })
      // Se le regresa el anticipo: hay que sacar billetes. Best-effort, como en los retiros.
      if (input.refund && order.deposit > 0) {
        openCashDrawerInBackground(await getConfigMap(db), (err) =>
          request.log.warn({ err }, 'cajón no abrió (devolución de anticipo)')
        )
      }
      return order
    }
  )
}
