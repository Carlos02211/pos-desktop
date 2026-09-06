import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { getConfigMap } from '../services/config'
import { printTicket } from '../services/printer'
import { createSale, getSaleWithItems } from '../services/ventas'

const createSaleSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive().max(999)
      })
    )
    .min(1),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER']),
  amountPaid: z.number().nonnegative().max(1_000_000).optional()
})

const idParam = z.object({ id: z.coerce.number().int().positive() })

export async function ventasRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/ventas', { preHandler: requireRole('COBRADOR') }, async (request, reply) => {
    const input = parse(createSaleSchema, request.body)
    const db = getDb()
    const sale = createSale(db, request.authUser!.id, input)

    emit('venta:nueva', {
      saleId: sale.id,
      total: sale.total,
      userId: request.authUser!.id,
      cashSessionId: sale.cashSessionId
    })

    // La impresión es best-effort: la venta ya está registrada.
    const print = await printTicket(sale, getConfigMap(db))
    if (!print.printed) request.log.warn({ err: print.error }, 'ticket no impreso')

    return reply.code(201).send({ ...sale, print })
  })

  // Reimpresión desde el historial (Sprint 5 expone la UII de historial).
  app.post(
    '/api/ventas/:id/reimprimir',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { id } = parse(idParam, request.params)
      const db = getDb()
      const sale = getSaleWithItems(db, id)
      const print = await printTicket(sale, getConfigMap(db))
      if (!print.printed)
        return reply.code(502).send({ error: print.error ?? 'No se pudo imprimir' })
      return { ok: true }
    }
  )
}
