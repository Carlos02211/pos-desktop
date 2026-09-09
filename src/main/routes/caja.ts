import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DIALECT, getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { backupDatabase } from '../services/backup'
import {
  closeSession,
  getActiveSession,
  getSessionSummary,
  listSessions,
  openSession,
  sessionToApi
} from '../services/caja'
import { getConfigMap } from '../services/config'

const openSchema = z.object({
  openingAmount: z.number().nonnegative().max(1_000_000)
})

const closeSchema = z.object({
  closingAmount: z.number().nonnegative().max(1_000_000)
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

    // El respaldo se ejecuta SIEMPRE al cerrar caja (no es opcional).
    // En PostgreSQL (Fase 2) el respaldo del servidor es responsabilidad de
    // `pg_dump` en cron; aquí sólo respaldamos el archivo SQLite.
    const backup =
      DIALECT === 'sqlite'
        ? backupDatabase(
            app.posContext.dbPath,
            (await getConfigMap(db)).backup_dir?.trim() || app.posContext.backupDir
          )
        : { ok: true as const, skipped: 'postgres' }
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
