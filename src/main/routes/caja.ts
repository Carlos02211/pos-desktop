import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { getActiveSession, openSession } from '../services/caja'

const openSchema = z.object({
  openingAmount: z.number().nonnegative().max(1_000_000)
})

/**
 * Apertura de caja y consulta de la sesión activa (necesario para vender en Sprint 2).
 * El cierre, el cálculo de esperado/diferencia y el respaldo llegan en Sprint 3.
 */
export async function cajaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/caja/sesion-activa', { preHandler: requireRole('COBRADOR') }, async (request) => {
    return getActiveSession(getDb(), request.authUser!.id) ?? null
  })

  app.post(
    '/api/caja/apertura',
    { preHandler: requireRole('COBRADOR') },
    async (request, reply) => {
      const { openingAmount } = parse(openSchema, request.body)
      const session = openSession(getDb(), request.authUser!.id, openingAmount)
      emit('caja:apertura', {
        cashSessionId: session.id,
        userId: request.authUser!.id,
        openingAmount
      })
      return reply.code(201).send(session)
    }
  )
}
