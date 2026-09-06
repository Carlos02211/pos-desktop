import jwt from 'jsonwebtoken'
import type { AuthUser, Role } from '../../shared/types'
import { getJwtSecret } from './store'

/** Duración del token: un turno laboral. */
const EXPIRES_IN = '8h'

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, getJwtSecret(), {
    expiresIn: EXPIRES_IN
  })
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload
  return {
    id: Number(payload.id),
    username: String(payload.username),
    role: payload.role as Role
  }
}
