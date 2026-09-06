import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { CashHistoryQuery, CashSessionListItem, CashSessionSummary } from '../../shared/types'
import type { CashSessionRow } from '../db/schema'
import { cashSessions, sales, users } from '../db/schema'
import type { DB } from '../db'
import { HttpError } from '../lib/http-error'
import { round2 } from '../lib/money'

/** Sesión de caja abierta del usuario, o `undefined`. */
export function getActiveSession(db: DB, userId: number): CashSessionRow | undefined {
  return db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.userId, userId), eq(cashSessions.status, 'OPEN')))
    .get()
}

/** Una sola caja abierta por usuario a la vez. */
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

function totalsFor(
  db: DB,
  cashSessionId: number
): {
  salesCount: number
  totalAll: number
  totalCash: number
  totalCard: number
  totalTransfer: number
} {
  const row = db
    .select({
      salesCount: sql<number>`count(*)`,
      totalAll: sql<number>`coalesce(sum(${sales.total}), 0)`,
      totalCash: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'CASH' then ${sales.total} else 0 end), 0)`,
      totalCard: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'CARD' then ${sales.total} else 0 end), 0)`,
      totalTransfer: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'TRANSFER' then ${sales.total} else 0 end), 0)`
    })
    .from(sales)
    .where(eq(sales.cashSessionId, cashSessionId))
    .get()!
  return {
    salesCount: row.salesCount,
    totalAll: round2(row.totalAll),
    totalCash: round2(row.totalCash),
    totalCard: round2(row.totalCard),
    totalTransfer: round2(row.totalTransfer)
  }
}

/** Resumen del turno abierto del usuario (para la pantalla de cierre). */
export function getSessionSummary(db: DB, userId: number): CashSessionSummary {
  const session = getActiveSession(db, userId)
  if (!session) throw new HttpError(409, 'No tienes una caja abierta.')
  const t = totalsFor(db, session.id)
  return {
    session,
    ...t,
    expectedCash: round2(session.openingAmount + t.totalCash)
  }
}

export interface CloseResult {
  session: CashSessionRow
  summary: CashSessionSummary
}

/**
 * Cierra la caja: guarda el efectivo contado, calcula el efectivo esperado
 * (apertura + ventas en efectivo) y la diferencia (contado - esperado).
 */
export function closeSession(db: DB, userId: number, closingAmount: number): CloseResult {
  const session = getActiveSession(db, userId)
  if (!session) throw new HttpError(409, 'No tienes una caja abierta.')
  if (closingAmount < 0) throw new HttpError(400, 'El efectivo contado no puede ser negativo.')

  const t = totalsFor(db, session.id)
  const expectedCash = round2(session.openingAmount + t.totalCash)
  const difference = round2(closingAmount - expectedCash)

  const [updated] = db
    .update(cashSessions)
    .set({
      status: 'CLOSED',
      closedAt: Math.floor(Date.now() / 1000),
      closingAmount: round2(closingAmount),
      expectedAmount: expectedCash,
      difference
    })
    .where(eq(cashSessions.id, session.id))
    .returning()
    .all()

  return {
    session: updated,
    summary: { session: updated, ...t, expectedCash }
  }
}

/** Historial de cortes de caja con el nombre del cobrador (panel de administración). */
export function listSessions(db: DB, query: CashHistoryQuery): CashSessionListItem[] {
  const conditions = [
    query.from != null ? gte(cashSessions.openedAt, query.from) : undefined,
    query.to != null ? lte(cashSessions.openedAt, query.to) : undefined,
    query.userId != null ? eq(cashSessions.userId, query.userId) : undefined
  ].filter(Boolean)
  const where = conditions.length ? and(...conditions) : undefined

  return db
    .select({
      id: cashSessions.id,
      userId: cashSessions.userId,
      userName: users.username,
      openedAt: cashSessions.openedAt,
      closedAt: cashSessions.closedAt,
      openingAmount: cashSessions.openingAmount,
      closingAmount: cashSessions.closingAmount,
      expectedAmount: cashSessions.expectedAmount,
      difference: cashSessions.difference,
      status: cashSessions.status
    })
    .from(cashSessions)
    .innerJoin(users, eq(users.id, cashSessions.userId))
    .where(where)
    .orderBy(desc(cashSessions.openedAt), desc(cashSessions.id))
    .all()
}
