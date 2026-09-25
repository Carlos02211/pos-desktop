import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { resolveBackupJob, runBackup } from '../services/backup'
import {
  addCashMovement,
  closeSession,
  getActiveSession,
  getSessionSummary,
  listSessionMovements,
  listSessions,
  openSession,
  sessionToApi
} from '../services/caja'

const openSchema = z.object({
  openingAmount: z.number().nonnegative().max(1_000_000)
})

const closeSchema = z.object({
  closingAmount: z.number().nonnegative().max(1_000_000)
})

const movementSchema = z.object({
  type: z.enum(['IN', 'OUT']),
  amount: z.number().positive().max(1_000_000),
  reason: z.string().min(2).max(120)
})

const historyQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  userId: z.coerce.number().int().positive().optional()
})

export async function cajaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/caja/sesion-activa', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const s = await getActiveSession(getDb(), request.authUser!.id)
    return s ? sessionToApi(s) : null
  })

  app.get('/api/caja/resumen', { preHandler: requireRole('COBRADOR') }, async (request) => {
    return getSessionSummary(getDb(), request.authUser!.id)
  })

  app.get('/api/caja/movimientos', { preHandler: requireRole('COBRADOR') }, async (request) => {
    return listSessionMovements(getDb(), request.authUser!.id)
  })

  app.post(
    '/api/caja/movimiento',
    { preHandler: requireRole('COBRADOR') },
    async (request, reply) => {
      const body = parse(movementSchema, request.body)
      const movement = await addCashMovement(getDb(), request.authUser!.id, body)
      return reply.code(201).send(movement)
    }
  )

  // Historial de cortes de caja (panel de administración).
  app.get('/api/caja/historial', { preHandler: requireRole('ADMIN') }, async (request) => {
    return listSessions(getDb(), parse(historyQuerySchema, request.query))
  })

  app.post(
    '/api/caja/apertura',
    { preHandler: requireRole('COBRADOR') },
    async (request, reply) => {
      const { openingAmount } = parse(openSchema, request.body)
      const session = await openSession(getDb(), request.authUser!.id, openingAmount)
      emit('caja:apertura', {
        cashSessionId: session.id,
        userId: request.authUser!.id,
        openingAmount
      })
      return reply.code(201).send(sessionToApi(session))
    }
  )

  app.post('/api/caja/cierre', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const { closingAmount } = parse(closeSchema, request.body)
    const db = getDb()
    const result = await closeSession(db, request.authUser!.id, closingAmount)

    // El respaldo se ejecuta SIEMPRE al cerrar caja (no es opcional): copia del archivo
    // en SQLite, pg_dump en PostgreSQL. Nunca lanza — un fallo no impide cerrar la caja.
    const job = await resolveBackupJob(app.posContext)
    const backup = await runBackup(job.target, job.dir)
    if (!backup.ok) request.log.error({ err: backup.error }, 'respaldo al cerrar caja falló')

    emit('caja:cierre', {
      cashSessionId: result.session.id,
      userId: request.authUser!.id,
      total: result.summary.totalAll,
      difference: result.session.difference ?? 0
    })

    return { ...result, backup }
  })
}
