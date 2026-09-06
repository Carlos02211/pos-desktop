import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PingResponse } from '../../shared/types'
import { DIALECT, pingDb } from '../db'
import { parse } from '../lib/validate'

const querySchema = z.object({
  echo: z.string().max(120).optional()
})

/**
 * Endpoint de diagnóstico (Sprint 0).
 * Verifica: cliente -> Fastify por HTTP, y Fastify -> base de datos.
 */
export async function pingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ping', async (request) => {
    const { echo } = parse(querySchema, request.query)

    let dbState: PingResponse['db'] = 'error'
    try {
      await pingDb()
      dbState = 'connected'
    } catch (err) {
      request.log.error({ err }, 'ping: fallo al consultar la base de datos')
    }

    const body: PingResponse & { echo?: string } = {
      ok: true,
      service: 'pos-spartan-tech',
      phase: DIALECT === 'pg' ? 2 : 1,
      now: Math.floor(Date.now() / 1000),
      db: dbState,
      engine: DIALECT === 'pg' ? 'postgres' : 'sqlite',
      version: app.posContext.version
    }
    if (echo) body.echo = echo
    return body
  })
}
