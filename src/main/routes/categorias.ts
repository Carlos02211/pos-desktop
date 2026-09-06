import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import {
  createCategory,
  deactivateCategory,
  listCategories,
  updateCategory
} from '../services/categorias'

const categorySchema = z.object({
  name: z.string().min(1).max(60),
  active: z.boolean().optional()
})
const idParam = z.object({ id: z.coerce.number().int().positive() })

export async function categoriasRoutes(app: FastifyInstance): Promise<void> {
  // COBRADOR ve sólo activas; ADMIN puede pedir todas con ?all=1
  app.get('/api/categorias', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const all =
      (request.query as { all?: string }).all === '1' && request.authUser!.role === 'ADMIN'
    return await listCategories(getDb(), all)
  })

  app.post('/api/categorias', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const category = await createCategory(getDb(), parse(categorySchema, request.body))
    return reply.code(201).send(category)
  })

  app.put('/api/categorias/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(idParam, request.params)
    return await updateCategory(getDb(), id, parse(categorySchema, request.body))
  })

  app.delete(
    '/api/categorias/:id',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { id } = parse(idParam, request.params)
      await deactivateCategory(getDb(), id)
      return reply.code(204).send()
    }
  )
}
