import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { LoginResponse } from '../../shared/types'
import type { DB } from '../db'
import { users } from '../db/schema'
import { HttpError } from '../lib/http-error'
import { signToken } from '../lib/jwt'

// Hash de descarte para igualar el tiempo de respuesta cuando el usuario no existe
// (evita enumeración de usuarios por temporización).
const DUMMY_HASH = '$2b$12$0000000000000000000000000000000000000000000000000000a'

export async function login(db: DB, username: string, password: string): Promise<LoginResponse> {
  const user = db.select().from(users).where(eq(users.username, username)).get()

  const passwordOk = await bcrypt.compare(password, user?.password ?? DUMMY_HASH)

  if (!user || user.active !== 1 || !passwordOk) {
    throw new HttpError(401, 'Credenciales inválidas')
  }

  const authUser = { id: user.id, username: user.username, role: user.role }
  return { token: signToken(authUser), user: authUser }
}
