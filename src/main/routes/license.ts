import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { license } from '../db/schema'
import { parse } from '../lib/validate'
import { activateLicense, getLicenseStatus } from '../services/license'

const activateSchema = z.object({
  key: z.string().min(10).max(80)
})

export async function licenseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/licencia/estado', async () => getLicenseStatus())

  app.post('/api/licencia/activar', async (request, reply) => {
    const { key } = parse(activateSchema, request.body)
    const result = await activateLicense(key)

    if (!result.ok) {
      return reply.code(403).send({ error: result.error })
    }

    // Espejo en la tabla `license` para visibilidad desde el panel admin.
    const db = getDb()
    await db.delete(license)
    await db.insert(license).values({
      fingerprint: result.status.fingerprint,
      key: key.trim().toUpperCase(),
      status: 'ACTIVE'
    })

    return result.status
  })
}
