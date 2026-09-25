import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { license } from '../db/schema'
import { Throttle } from '../lib/throttle'
import { parse } from '../lib/validate'
import { activateLicense, getLicenseStatus } from '../services/license'

const activateSchema = z.object({
  key: z.string().min(10).max(200)
})

// Freno simple por IP a los intentos fallidos. No es la defensa real (el espacio de
// claves ya hace inviable adivinar por fuerza bruta — ver src/main/services/license.ts),
// es sólo una capa extra para no dejar el endpoint abierto a intentos sin límite.
const activateThrottle = new Throttle({ max: 5, windowMs: 60_000 })

export async function licenseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/licencia/estado', async () => getLicenseStatus())

  app.post('/api/licencia/activar', async (request, reply) => {
    if (activateThrottle.isBlocked(request.ip)) {
      return reply.code(429).send({ error: 'Demasiados intentos. Probá de nuevo en un minuto.' })
    }

    const { key } = parse(activateSchema, request.body)
    const result = await activateLicense(key)

    if (!result.ok) {
      activateThrottle.recordFailure(request.ip)
      return reply.code(403).send({ error: result.error })
    }
    activateThrottle.clear(request.ip)

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
