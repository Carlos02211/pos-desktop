import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { createSale } from '../services/ventas'

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

export async function ventasRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/ventas', { preHandler: requireRole('COBRADOR') }, async (request, reply) => {
    const input = parse(createSaleSchema, request.body)
    const sale = createSale(getDb(), request.authUser!.id, input)

    emit('venta:nueva', {
      saleId: sale.id,
      total: sale.total,
      userId: request.authUser!.id,
      cashSessionId: sale.cashSessionId
    })

    // La impresión del ticket se conecta en Sprint 3 (node-thermal-printer).
    return reply.code(201).send(sale)
  })
}
