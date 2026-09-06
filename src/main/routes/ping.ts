import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PingResponse } from '../../shared/types'
import { getDb } from '../db'
import { parse } from '../lib/validate'

const querySchema = z.object({
  echo: z.string().max(120).optional()
})

/**
 * Endpoint de diagnóstico (Sprint 0).
 * Verifica: Renderer -> Fastify por HTTP, y Fastify -> SQLite.
 */
export async function pingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ping', async (request) => {
    const { echo } = parse(querySchema, request.query)

    let dbState: PingResponse['db'] = 'error'
    try {
      getDb().get(sql`select 1`)
      dbState = 'connected'
    } catch (err) {
      request.log.error({ err }, 'ping: fallo al consultar SQLite')
    }

    const body: PingResponse & { echo?: string } = {
      ok: true,
      service: 'pos-spartan-tech',
      phase: 1,
      now: Math.floor(Date.now() / 1000),
      db: dbState,
      version: app.posContext.version
    }
    if (echo) body.echo = echo
    return body
  })
}
