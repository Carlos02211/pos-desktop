import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { LoginResponse } from '../../shared/types'
import type { DB } from '../db'
import { users } from '../db/schema'
import { HttpError } from '../lib/http-error'
import { signToken } from '../lib/jwt'

// Hash bcrypt REAL (de una contraseña que nadie usa) para igualar el tiempo de
// respuesta cuando el usuario no existe — así `bcrypt.compare` hace el mismo trabajo
// que con un usuario real y no se puede enumerar usuarios por temporización.
const DUMMY_HASH = '$2b$12$qk/U8S9KjVh4QLih4c9QzODjrElOkRiVxNdwDmgc1kF5TOg41zUM.'

export async function login(db: DB, username: string, password: string): Promise<LoginResponse> {
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)

  const passwordOk = await bcrypt.compare(password, user?.password ?? DUMMY_HASH)

  if (!user || user.active !== 1 || !passwordOk) {
    throw new HttpError(401, 'Credenciales inválidas')
  }

  const authUser = { id: user.id, username: user.username, role: user.role }
  return { token: signToken(authUser), user: authUser }
}
