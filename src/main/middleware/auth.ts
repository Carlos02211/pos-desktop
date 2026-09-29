import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthUser, Role } from '../../shared/types'
import { getDb } from '../db'
import { users } from '../db/schema'
import { verifyToken } from '../lib/jwt'

/**
 * El token dura 8 h, pero un usuario desactivado (o con otro rol) no debe seguir operando
 * hasta que venza: se relee de la BD en cada petición. `null` = ya no puede entrar.
 */
export async function currentUser(tokenUser: AuthUser): Promise<AuthUser | null> {
  const [row] = await getDb()
    .select({ id: users.id, username: users.username, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, tokenUser.id))
    .limit(1)
  if (!row || row.active !== 1) return null
  return { id: row.id, username: row.username, role: row.role }
}

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
  let tokenUser: AuthUser
  try {
    tokenUser = verifyToken(header.slice(7))
  } catch {
    await reply.code(401).send({ error: 'Token inválido o expirado' })
    return
  }
  const user = await currentUser(tokenUser)
  if (!user) {
    await reply.code(401).send({ error: 'Tu usuario fue desactivado. Habla con el administrador.' })
    return
  }
  request.authUser = user
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
