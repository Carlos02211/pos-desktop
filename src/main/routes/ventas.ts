import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { round2 } from '../lib/money'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { getConfigMap } from '../services/config'
import { printTicket, ticketLines } from '../services/printer'
import {
  addToSale,
  assertCanReprint,
  createSale,
  creditBalanceForSale,
  getSaleWithItems,
  listSales,
  listTurnSales
} from '../services/ventas'

const salesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  userId: z.coerce.number().int().positive().optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'CREDIT']).optional()
})

const saleLinesSchema = z
  .array(
    z.object({
      productId: z.number().int().positive(),
      // Entera para productos PIEZA, decimal (kg) para productos KG — validado en el servicio,
      // que es quien conoce la unidad del producto.
      quantity: z.number().positive().max(9_999),
      price: z.number().positive().max(1_000_000).optional(),
      note: z.string().trim().max(60).optional()
    })
  )
  .min(1)

const createSaleSchema = z.object({
  items: saleLinesSchema,
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'CREDIT']),
  amountPaid: z.number().nonnegative().max(1_000_000).optional(),
  customerId: z.number().int().positive().optional(),
  /** Token del cliente para deduplicar reintentos de red / doble submit. */
  clientRequestId: z.string().min(8).max(64).optional()
})

const addToSaleSchema = z.object({
  items: saleLinesSchema,
  /** CASH: efectivo recibido por lo agregado. */
  amountPaid: z.number().nonnegative().max(1_000_000).optional(),
  clientRequestId: z.string().min(8).max(64).optional()
})

/**
 * Dedup de ventas por `clientRequestId`. Si el POST llega dos veces (timeout de
 * red + reintento, doble clic), la segunda devuelve la misma venta en vez de
 * crear otra con su propio folio. En memoria: suficiente para un servidor único.
 */
const IDEMPOTENCY_TTL_MS = 5 * 60_000
/**
 * Se guarda la venta EN CURSO (promesa), no sólo la terminada: un doble clic manda los dos
 * POST antes de que el primero haga commit, y ambos pasaban el chequeo creando dos ventas.
 */
const recentSales = new Map<string, { saleId: Promise<number>; at: number }>()

function rememberSale(key: string, saleId: Promise<number>): void {
  const now = Date.now()
  for (const [k, v] of recentSales) if (now - v.at > IDEMPOTENCY_TTL_MS) recentSales.delete(k)
  const entry = { saleId, at: now }
  recentSales.set(key, entry)
  // Si la venta falla (sin caja, producto inactivo…) el reintento debe poder intentarlo de nuevo.
  saleId.catch(() => {
    if (recentSales.get(key) === entry) recentSales.delete(key)
  })
}

const idParam = z.object({ id: z.coerce.number().int().positive() })

export async function ventasRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/ventas', { preHandler: requireRole('COBRADOR') }, async (request, reply) => {
    const input = parse(createSaleSchema, request.body)
    const db = getDb()

    const dedupKey = input.clientRequestId
      ? `${request.authUser!.id}:${input.clientRequestId}`
      : null
    if (dedupKey) {
      const prev = recentSales.get(dedupKey)
      if (prev && Date.now() - prev.at <= IDEMPOTENCY_TTL_MS) {
        const existing = await getSaleWithItems(db, await prev.saleId)
        return reply.code(200).send({ ...existing, print: { printed: false }, duplicate: true })
      }
    }

    const pending = createSale(db, request.authUser!.id, input)
    if (dedupKey)
      rememberSale(
        dedupKey,
        pending.then((s) => s.id)
      )
    const sale = await pending

    emit('venta:nueva', {
      saleId: sale.id,
      total: sale.total,
      userId: request.authUser!.id,
      cashSessionId: sale.cashSessionId
    })

    if (sale.creditAccountId) {
      emit('cuenta:abono', {
        creditAccountId: sale.creditAccountId,
        customerId: input.customerId!,
        balance: round2(sale.total - (sale.amountPaid ?? 0)),
        settled: false
      })
    }

    // La impresión es best-effort: la venta ya está registrada.
    const print = await printTicket(sale, await getConfigMap(db), { openDrawer: true })
    if (!print.printed && !print.skipped)
      request.log.warn({ err: print.error }, 'ticket no impreso')

    return reply.code(201).send({ ...sale, print })
  })

  // Historial de ventas (paginado + filtros).
  app.get('/api/ventas', { preHandler: requireRole('ADMIN') }, async (request) => {
    return listSales(getDb(), parse(salesQuerySchema, request.query))
  })

  // Ventas del turno abierto (cobrador: su caja; admin: todas las abiertas).
  app.get('/api/ventas/turno', { preHandler: requireRole('COBRADOR') }, async (request) => {
    return listTurnSales(getDb(), request.authUser!)
  })

  // El cliente olvidó algo: se agrega a la venta (mismo folio) y sale un ticket actualizado.
  app.post(
    '/api/ventas/:id/agregar',
    { preHandler: requireRole('COBRADOR') },
    async (request, reply) => {
      const { id } = parse(idParam, request.params)
      const input = parse(addToSaleSchema, request.body)
      const db = getDb()

      // Mismo dedup que la venta nueva: un doble clic no debe agregar los productos dos veces.
      const dedupKey = input.clientRequestId
        ? `${request.authUser!.id}:agregar:${input.clientRequestId}`
        : null
      if (dedupKey) {
        const prev = recentSales.get(dedupKey)
        if (prev && Date.now() - prev.at <= IDEMPOTENCY_TTL_MS) {
          await prev.saleId
          const existing = await getSaleWithItems(db, id)
          return reply.code(200).send({
            ...existing,
            addedTotal: 0,
            addedChange: null,
            print: { printed: false },
            duplicate: true
          })
        }
      }

      const pending = addToSale(db, request.authUser!, id, input)
      if (dedupKey)
        rememberSale(
          dedupKey,
          pending.then((s) => s.id)
        )
      const { credit, ...sale } = await pending

      emit('venta:actualizada', {
        saleId: sale.id,
        total: sale.total,
        userId: request.authUser!.id,
        cashSessionId: sale.cashSessionId
      })
      if (credit) {
        emit('cuenta:abono', {
          creditAccountId: credit.accountId,
          customerId: credit.customerId,
          balance: credit.balance,
          settled: false
        })
      }

      const print = await printTicket(sale, await getConfigMap(db), {
        openDrawer: sale.paymentMethod === 'CASH',
        updated: true
      })
      if (!print.printed && !print.skipped)
        request.log.warn({ err: print.error }, 'ticket actualizado no impreso')

      return reply.code(200).send({ ...sale, print })
    }
  )

  app.get('/api/ventas/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(idParam, request.params)
    return getSaleWithItems(getDb(), id)
  })

  // Vista previa del ticket (Imprimir → PDF). Es una copia: mismos permisos que reimprimir.
  app.get('/api/ventas/:id/ticket', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const { id } = parse(idParam, request.params)
    const db = getDb()
    await assertCanReprint(db, request.authUser!, id)
    const sale = await getSaleWithItems(db, id)
    return {
      lines: ticketLines(sale, await getConfigMap(db), {
        reprintAt: Math.floor(Date.now() / 1000),
        creditBalance:
          sale.paymentMethod === 'CREDIT'
            ? ((await creditBalanceForSale(db, sale.id)) ?? undefined)
            : undefined
      })
    }
  })

  // Reimpresión: el admin, cualquier ticket; el cobrador, sólo el último de su caja.
  app.post(
    '/api/ventas/:id/reimprimir',
    { preHandler: requireRole('COBRADOR') },
    async (request, reply) => {
      const { id } = parse(idParam, request.params)
      const db = getDb()
      await assertCanReprint(db, request.authUser!, id)
      const sale = await getSaleWithItems(db, id)
      const print = await printTicket(sale, await getConfigMap(db), {
        reprintAt: Math.floor(Date.now() / 1000),
        creditBalance:
          sale.paymentMethod === 'CREDIT'
            ? ((await creditBalanceForSale(db, sale.id)) ?? undefined)
            : undefined
      })
      if (print.skipped) {
        return reply
          .code(409)
          .send({ error: 'No hay impresora activada (Configuración → Impresora de tickets).' })
      }
      if (!print.printed)
        return reply.code(502).send({ error: print.error ?? 'No se pudo imprimir' })
      return { ok: true }
    }
  )
}
