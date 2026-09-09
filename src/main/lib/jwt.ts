import jwt from 'jsonwebtoken'
import type { AuthUser, Role } from '../../shared/types'
import { getJwtSecret } from './store'

/** Duración del token: un turno laboral. */
const EXPIRES_IN = '8h'
const ALGORITHM = 'HS256' as const
const ISSUER = 'pos-spartan-tech'

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, getJwtSecret(), {
    expiresIn: EXPIRES_IN,
    algorithm: ALGORITHM,
    issuer: ISSUER
  })
}

export function verifyToken(token: string): AuthUser {
  // Allowlist explícita de algoritmo — cierra la puerta a `alg: none` y a
  // confusiones RS↔HS, aunque hoy el secreto sea simétrico.
  const payload = jwt.verify(token, getJwtSecret(), {
    algorithms: [ALGORITHM],
    issuer: ISSUER
  }) as jwt.JwtPayload
  return {
    id: Number(payload.id),
    username: String(payload.username),
    role: payload.role as Role
  }
}
