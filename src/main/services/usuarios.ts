import bcrypt from 'bcryptjs'
import { asc, eq } from 'drizzle-orm'
import type { CreateUserInput, UpdateUserInput, UserListItem } from '../../shared/types'
import type { DB } from '../db'
import { users } from '../db/schema'
import { HttpError } from '../lib/http-error'

const BCRYPT_ROUNDS = 12

const publicColumns = {
  id: users.id,
  username: users.username,
  role: users.role,
  active: users.active,
  createdAt: users.createdAt
}

export function listUsers(db: DB): UserListItem[] {
  return db.select(publicColumns).from(users).orderBy(asc(users.username)).all()
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export async function createUser(db: DB, input: CreateUserInput): Promise<UserListItem> {
  const username = normalizeUsername(input.username)
  if (username.length < 3) throw new HttpError(400, 'El usuario debe tener al menos 3 caracteres.')
  if (input.password.length < 6) {
    throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.')
  }
  if (db.select().from(users).where(eq(users.username, username)).get()) {
    throw new HttpError(409, 'Ya existe un usuario con ese nombre.')
  }

  const password = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
  const [row] = db
    .insert(users)
    .values({ username, password, role: input.role })
    .returning(publicColumns)
    .all()
  return row
}

export async function updateUser(
  db: DB,
  id: number,
  input: UpdateUserInput,
  actingUserId: number
): Promise<UserListItem> {
  const current = db.select().from(users).where(eq(users.id, id)).get()
  if (!current) throw new HttpError(404, 'Usuario no encontrado.')

  // El ADMIN no puede desactivarse ni quitarse el rol a sí mismo.
  if (id === actingUserId) {
    if (input.active === false) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.')
    if (input.role && input.role !== current.role) {
      throw new HttpError(400, 'No puedes cambiar tu propio rol.')
    }
  }

  const changes: Partial<typeof users.$inferInsert> = {}

  if (input.username !== undefined) {
    const username = normalizeUsername(input.username)
    if (username.length < 3)
      throw new HttpError(400, 'El usuario debe tener al menos 3 caracteres.')
    const clash = db.select().from(users).where(eq(users.username, username)).get()
    if (clash && clash.id !== id) throw new HttpError(409, 'Ya existe un usuario con ese nombre.')
    changes.username = username
  }
  if (input.role !== undefined) changes.role = input.role
  if (input.active !== undefined) changes.active = input.active ? 1 : 0
  if (input.password) {
    if (input.password.length < 6) {
      throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres.')
    }
    changes.password = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
  }

  const [row] = db.update(users).set(changes).where(eq(users.id, id)).returning(publicColumns).all()
  return row
}

/** Baja = desactivación. No se puede desactivar la propia cuenta. */
export function deactivateUser(db: DB, id: number, actingUserId: number): void {
  if (id === actingUserId) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.')
  const current = db.select().from(users).where(eq(users.id, id)).get()
  if (!current) throw new HttpError(404, 'Usuario no encontrado.')
  db.update(users).set({ active: 0 }).where(eq(users.id, id)).run()
}
