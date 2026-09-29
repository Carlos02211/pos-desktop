import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import type { DrawerResult } from '../../shared/types'
import { HttpError } from '../lib/http-error'
import { resolveBackupJob, runBackup } from '../services/backup'
import {
  addCashMovement,
  closeSession,
  getActiveSession,
  getSessionSummary,
  listSessionMovements,
  listMovementsForSession,
  listSessions,
  openSession,
  sessionToApi
} from '../services/caja'
import { getConfigMap } from '../services/config'
import { cashDrawerEnabled, openCashDrawer, openCashDrawerInBackground } from '../services/printer'

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
      // Retiro o ingreso: hay que meter o sacar billetes. Best-effort, como el ticket.
      openCashDrawerInBackground(await getConfigMap(getDb()), (err) =>
        request.log.warn({ err }, 'cajón no abrió (movimiento)')
      )
      return reply.code(201).send(movement)
    }
  )

  // Retiros / ingresos de un turno (detalle del corte en el panel de administración).
  app.get('/api/caja/:id/movimientos', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), request.params)
    return listMovementsForSession(getDb(), id)
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

  // ¿Mostrar el botón "Abrir cajón" en el panel del cobrador?
  app.get('/api/caja/cajon', { preHandler: requireRole('COBRADOR') }, async () => ({
    enabled: cashDrawerEnabled(await getConfigMap(getDb()))
  }))

  // Apertura a mano (dar cambio sin venta, revisar el fondo). Sólo con caja abierta y queda
  // en el log con quién la pidió: un cajón que se abre sin venta es lo primero que se revisa
  // cuando no cuadra el corte.
  app.post(
    '/api/caja/cajon',
    { preHandler: requireRole('COBRADOR') },
    async (request): Promise<DrawerResult> => {
      const user = request.authUser!
      const db = getDb()
      if (user.role !== 'ADMIN' && !(await getActiveSession(db, user.id))) {
        throw new HttpError(409, 'Abre caja para usar el cajón.')
      }
      const result = await openCashDrawer(await getConfigMap(db))
      request.log.info({ userId: user.id, opened: result.opened }, 'cajón abierto a mano')
      return result
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
