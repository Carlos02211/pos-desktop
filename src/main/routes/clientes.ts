import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import {
  createCustomer,
  deactivateCustomer,
  listCustomers,
  updateCustomer
} from '../services/clientes'

const customerSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(40).optional(),
  notes: z.string().max(400).optional(),
  active: z.boolean().optional()
})
const idParam = z.object({ id: z.coerce.number().int().positive() })

export async function clientesRoutes(app: FastifyInstance): Promise<void> {
  // El cobrador necesita la lista para fiar en el punto de venta.
  app.get('/api/clientes', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const all =
      (request.query as { all?: string }).all === '1' && request.authUser!.role === 'ADMIN'
    return listCustomers(getDb(), all)
  })

  // El cobrador puede dar de alta un cliente rápido durante la venta.
  app.post('/api/clientes', { preHandler: requireRole('COBRADOR') }, async (request, reply) => {
    return reply.code(201).send(createCustomer(getDb(), parse(customerSchema, request.body)))
  })

  app.put('/api/clientes/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(idParam, request.params)
    return updateCustomer(getDb(), id, parse(customerSchema, request.body))
  })

  app.delete('/api/clientes/:id', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const { id } = parse(idParam, request.params)
    deactivateCustomer(getDb(), id)
    return reply.code(204).send()
  })
}
