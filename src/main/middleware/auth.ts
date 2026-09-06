import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthUser, Role } from '../../shared/types'
import { verifyToken } from '../lib/jwt'

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser
  }
}

/**
 * `preHandler` que exige un JWT válido en `Authorization: Bearer <token>`.
 * Deja el usuario en `request.authUser`.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'No autorizado' })
    return
  }
  try {
    request.authUser = verifyToken(header.slice(7))
  } catch {
    await reply.code(401).send({ error: 'Token inválido o expirado' })
  }
}

/**
 * `preHandler` que exige autenticación y uno de los roles indicados.
 * ADMIN siempre pasa (tiene acceso a todo).
 */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply)
    if (reply.sent) return
    const role = request.authUser!.role
    if (role !== 'ADMIN' && !roles.includes(role)) {
      await reply.code(403).send({ error: 'Sin permisos' })
    }
  }
}
