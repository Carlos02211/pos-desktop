import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { createUser, deactivateUser, listUsers, updateUser } from '../services/usuarios'

const createSchema = z.object({
  username: z.string().min(3).max(60),
  password: z.string().min(6).max(200),
  role: z.enum(['ADMIN', 'COBRADOR'])
})

const updateSchema = z.object({
  username: z.string().min(3).max(60).optional(),
  role: z.enum(['ADMIN', 'COBRADOR']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(200).optional()
})

const idParam = z.object({ id: z.coerce.number().int().positive() })

export async function usuariosRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/usuarios',
    { preHandler: requireRole('ADMIN') },
    async () => await listUsers(getDb())
  )

  app.post('/api/usuarios', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const user = await createUser(getDb(), parse(createSchema, request.body))
    return reply.code(201).send(user)
  })

  app.put('/api/usuarios/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(idParam, request.params)
    return await updateUser(getDb(), id, parse(updateSchema, request.body), request.authUser!.id)
  })

  app.delete('/api/usuarios/:id', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const { id } = parse(idParam, request.params)
    await deactivateUser(getDb(), id, request.authUser!.id)
    return reply.code(204).send()
  })
}
