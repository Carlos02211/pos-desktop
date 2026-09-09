import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { round2 } from '../lib/money'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { getConfigMap } from '../services/config'
import { printTicket } from '../services/printer'
import { createSale, getSaleWithItems, listSales } from '../services/ventas'

const salesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  userId: z.coerce.number().int().positive().optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER']).optional()
})

const createSaleSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        // Entera para productos PIEZA, decimal (kg) para productos KG — validado en el servicio,
        // que es quien conoce la unidad del producto.
        quantity: z.number().positive().max(999),
        price: z.number().positive().max(1_000_000).optional()
      })
    )
    .min(1),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'CREDIT']),
  amountPaid: z.number().nonnegative().max(1_000_000).optional(),
  customerId: z.number().int().positive().optional()
})

const idParam = z.object({ id: z.coerce.number().int().positive() })

export async function ventasRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/ventas', { preHandler: requireRole('COBRADOR') }, async (request, reply) => {
    const input = parse(createSaleSchema, request.body)
    const db = getDb()
    const sale = await createSale(db, request.authUser!.id, input)

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
    const print = await printTicket(sale, await getConfigMap(db))
    if (!print.printed) request.log.warn({ err: print.error }, 'ticket no impreso')

    return reply.code(201).send({ ...sale, print })
  })

  // Historial de ventas (paginado + filtros).
  app.get('/api/ventas', { preHandler: requireRole('ADMIN') }, async (request) => {
    return listSales(getDb(), parse(salesQuerySchema, request.query))
  })

  app.get('/api/ventas/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(idParam, request.params)
    return getSaleWithItems(getDb(), id)
  })

  // Reimpresión desde el historial.
  app.post(
    '/api/ventas/:id/reimprimir',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { id } = parse(idParam, request.params)
      const db = getDb()
      const sale = await getSaleWithItems(db, id)
      const print = await printTicket(sale, await getConfigMap(db))
      if (!print.printed)
        return reply.code(502).send({ error: print.error ?? 'No se pudo imprimir' })
      return { ok: true }
    }
  )
}
