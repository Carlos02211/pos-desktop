import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireAuth } from '../middleware/auth'
import { login } from '../services/auth'

const loginSchema = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200)
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (request) => {
    const { username, password } = parse(loginSchema, request.body)
    return login(getDb(), username, password)
  })

  // JWT stateless: el servidor no guarda sesión. El cliente descarta el token.
  // El endpoint existe por simetría y para una futura lista de revocación (Fase 2).
  app.post('/api/auth/logout', async () => ({ ok: true }))

  // Devuelve el usuario del token — el cliente lo usa para revalidar al reanudar.
  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => ({
    user: request.authUser
  }))
}
