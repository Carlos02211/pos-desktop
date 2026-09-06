import { and, eq } from 'drizzle-orm'
import type { CashSessionRow } from '../db/schema'
import { cashSessions } from '../db/schema'
import type { DB } from '../db'
import { HttpError } from '../lib/http-error'

/** Sesión de caja abierta del usuario, o `undefined`. */
export function getActiveSession(db: DB, userId: number): CashSessionRow | undefined {
  return db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.userId, userId), eq(cashSessions.status, 'OPEN')))
    .get()
}

/**
 * Abre una caja. Regla de desarrollo: una sola caja abierta por usuario a la vez.
 * (Sprint 3 añade el cierre, el cálculo de esperado/diferencia y el respaldo.)
 */
export function openSession(db: DB, userId: number, openingAmount: number): CashSessionRow {
  if (getActiveSession(db, userId)) {
    throw new HttpError(409, 'Ya tienes una caja abierta.')
  }
  if (openingAmount < 0) {
    throw new HttpError(400, 'El monto inicial no puede ser negativo.')
  }
  const [row] = db
    .insert(cashSessions)
    .values({ userId, openingAmount, status: 'OPEN' })
    .returning()
    .all()
  return row
}
