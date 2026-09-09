import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { Throttle } from '../lib/throttle'
import { parse } from '../lib/validate'
import { requireAuth } from '../middleware/auth'
import { login } from '../services/auth'

const loginSchema = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200)
})

// Freno de fuerza bruta: por IP y por (IP, usuario). 10 fallos en 5 min bloquean 5 min.
const loginThrottle = new Throttle({ max: 10, windowMs: 5 * 60_000 })

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = parse(loginSchema, request.body)
    const ipKey = request.ip
    const userKey = `${request.ip}|${username.toLowerCase()}`

    if (loginThrottle.isBlocked(ipKey) || loginThrottle.isBlocked(userKey)) {
      return reply
        .code(429)
        .send({ error: 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.' })
    }

    try {
      const result = await login(getDb(), username, password)
      loginThrottle.clear(ipKey)
      loginThrottle.clear(userKey)
      return result
    } catch (err) {
      loginThrottle.recordFailure(ipKey)
      loginThrottle.recordFailure(userKey)
      throw err
    }
  })

  // JWT stateless: el servidor no guarda sesión. El cliente descarta el token.
  // El endpoint existe por simetría y para una futura lista de revocación (Fase 2).
  app.post('/api/auth/logout', async () => ({ ok: true }))

  // Devuelve el usuario del token — el cliente lo usa para revalidar al reanudar.
  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => ({
    user: request.authUser
  }))
}
