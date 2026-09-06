import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { backupDatabase } from '../services/backup'
import { closeSession, getActiveSession, getSessionSummary, openSession } from '../services/caja'
import { getConfigMap } from '../services/config'

const openSchema = z.object({
  openingAmount: z.number().nonnegative().max(1_000_000)
})

const closeSchema = z.object({
  closingAmount: z.number().nonnegative().max(1_000_000)
})

export async function cajaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/caja/sesion-activa', { preHandler: requireRole('COBRADOR') }, async (request) => {
    return getActiveSession(getDb(), request.authUser!.id) ?? null
  })

  app.get('/api/caja/resumen', { preHandler: requireRole('COBRADOR') }, async (request) => {
    return getSessionSummary(getDb(), request.authUser!.id)
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

  app.post('/api/caja/cierre', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const { closingAmount } = parse(closeSchema, request.body)
    const db = getDb()
    const result = closeSession(db, request.authUser!.id, closingAmount)

    // El respaldo se ejecuta SIEMPRE al cerrar caja (no es opcional).
    const backupDir = getConfigMap(db).backup_dir?.trim() || app.posContext.backupDir
    const backup = backupDatabase(app.posContext.dbPath, backupDir)
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
