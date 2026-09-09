import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { CashHistoryQuery, CashSessionListItem, CashSessionSummary } from '../../shared/types'
import type { CashSessionRow } from '../db/schema'
import { cashSessions, creditPayments, sales, users } from '../db/schema'
import type { DB } from '../db'
import { withTx, lockRow } from '../db/tx'
import { isUniqueViolation } from '../lib/db-errors'
import { HttpError } from '../lib/http-error'
import { fromCents, toCents } from '../lib/money'

/** Importes de una sesión de caja (centavos) → pesos, para la API. */
export function sessionToApi(row: CashSessionRow): CashSessionRow {
  return {
    ...row,
    openingAmount: fromCents(row.openingAmount),
    closingAmount: row.closingAmount == null ? null : fromCents(row.closingAmount),
    expectedAmount: row.expectedAmount == null ? null : fromCents(row.expectedAmount),
    difference: row.difference == null ? null : fromCents(row.difference)
  }
}

/** Sesión de caja abierta del usuario, o `undefined`. Importes en CENTAVOS (uso interno). */
export async function getActiveSession(
  db: DB,
  userId: number
): Promise<CashSessionRow | undefined> {
  const [row] = await db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.userId, userId), eq(cashSessions.status, 'OPEN')))
    .limit(1)
  return row
}

/**
 * Una sola caja abierta por usuario a la vez. La garantía real es el índice único
 * parcial `cash_sessions_one_open_per_user` (ver schema): si dos aperturas entran
 * a la vez, la BD rechaza la segunda y aquí la traducimos a un 409 legible.
 */
export async function openSession(
  db: DB,
  userId: number,
  openingAmount: number
): Promise<CashSessionRow> {
  if (openingAmount < 0) {
    throw new HttpError(400, 'El monto inicial no puede ser negativo.')
  }
  if (await getActiveSession(db, userId)) {
    throw new HttpError(409, 'Ya tienes una caja abierta.')
  }
  try {
    const [row] = await db
      .insert(cashSessions)
      .values({ userId, openingAmount: toCents(openingAmount), status: 'OPEN' })
      .returning()
    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'Ya tienes una caja abierta.')
    }
    throw err
  }
}

interface SessionTotals {
  salesCount: number
  totalAll: number
  totalCash: number
  totalCard: number
  totalTransfer: number
  totalCredit: number
  /** Abono inicial en efectivo de las ventas fiadas del turno. */
  creditDownCash: number
  /** Abonos en efectivo a cuentas anteriores recibidos en el turno. */
  abonosCash: number
}

async function totalsFor(db: DB, cashSessionId: number): Promise<SessionTotals> {
  const [s] = await db
    .select({
      salesCount: sql<number>`count(*)`,
      totalAll: sql<number>`coalesce(sum(${sales.total}), 0)`,
      totalCash: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'CASH' then ${sales.total} else 0 end), 0)`,
      totalCard: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'CARD' then ${sales.total} else 0 end), 0)`,
      totalTransfer: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'TRANSFER' then ${sales.total} else 0 end), 0)`,
      // Crédito otorgado = total fiado menos lo abonado al momento de la venta.
      totalCredit: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'CREDIT' then ${sales.total} - coalesce(${sales.amountPaid}, 0) else 0 end), 0)`,
      creditDownCash: sql<number>`coalesce(sum(case when ${sales.paymentMethod} = 'CREDIT' then coalesce(${sales.amountPaid}, 0) else 0 end), 0)`
    })
    .from(sales)
    .where(eq(sales.cashSessionId, cashSessionId))

  const [abono] = await db
    .select({
      abonosCash: sql<number>`coalesce(sum(case when ${creditPayments.paymentMethod} = 'CASH' then ${creditPayments.amount} else 0 end), 0)`
    })
    .from(creditPayments)
    .where(eq(creditPayments.cashSessionId, cashSessionId))

  // Todas las columnas sumadas son centavos enteros → la suma es exacta.
  return {
    salesCount: Number(s.salesCount),
    totalAll: Number(s.totalAll),
    totalCash: Number(s.totalCash),
    totalCard: Number(s.totalCard),
    totalTransfer: Number(s.totalTransfer),
    totalCredit: Number(s.totalCredit),
    creditDownCash: Number(s.creditDownCash),
    abonosCash: Number(abono.abonosCash)
  }
}

/** Efectivo esperado en caja, en CENTAVOS. */
function expectedCashCentsFor(openingAmountCents: number, t: SessionTotals): number {
  return openingAmountCents + t.totalCash + t.creditDownCash + t.abonosCash
}

/** `t` y `session` vienen en centavos; el resumen sale en pesos para la API. */
function toSummary(session: CashSessionRow, t: SessionTotals): CashSessionSummary {
  return {
    session: sessionToApi(session),
    salesCount: t.salesCount,
    totalAll: fromCents(t.totalAll),
    totalCash: fromCents(t.totalCash),
    totalCard: fromCents(t.totalCard),
    totalTransfer: fromCents(t.totalTransfer),
    totalCredit: fromCents(t.totalCredit),
    abonosCash: fromCents(t.abonosCash),
    expectedCash: fromCents(expectedCashCentsFor(session.openingAmount, t))
  }
}

/** Resumen del turno abierto del usuario (para la pantalla de cierre). */
export async function getSessionSummary(db: DB, userId: number): Promise<CashSessionSummary> {
  const session = await getActiveSession(db, userId)
  if (!session) throw new HttpError(409, 'No tienes una caja abierta.')
  return toSummary(session, await totalsFor(db, session.id))
}

export interface CloseResult {
  session: CashSessionRow
  summary: CashSessionSummary
}

/**
 * Cierra la caja: guarda el efectivo contado, calcula el efectivo esperado
 * (apertura + ventas en efectivo + enganches + abonos) y la diferencia.
 */
export async function closeSession(
  db: DB,
  userId: number,
  closingAmount: number
): Promise<CloseResult> {
  if (closingAmount < 0) throw new HttpError(400, 'El efectivo contado no puede ser negativo.')

  return withTx(db, async (tx) => {
    const session = await getActiveSession(tx, userId)
    if (!session) throw new HttpError(409, 'No tienes una caja abierta.')
    // Bloquea la sesión para que ninguna venta en vuelo se cuele entre el cálculo
    // de totales y el cierre (dejaría el arqueo mal en Fase 2).
    await lockRow(tx, 'cash_sessions', session.id)

    const t = await totalsFor(tx, session.id)
    const expectedCashCents = expectedCashCentsFor(session.openingAmount, t)
    const closingCents = toCents(closingAmount)

    const [updated] = await tx
      .update(cashSessions)
      .set({
        status: 'CLOSED',
        closedAt: Math.floor(Date.now() / 1000),
        closingAmount: closingCents,
        expectedAmount: expectedCashCents,
        difference: closingCents - expectedCashCents
      })
      .where(eq(cashSessions.id, session.id))
      .returning()

    return { session: sessionToApi(updated), summary: toSummary(updated, t) }
  })
}

/** Historial de cortes de caja con el nombre del cobrador (panel de administración). */
export async function listSessions(
  db: DB,
  query: CashHistoryQuery
): Promise<CashSessionListItem[]> {
  const conditions = [
    query.from != null ? gte(cashSessions.openedAt, query.from) : undefined,
    query.to != null ? lte(cashSessions.openedAt, query.to) : undefined,
    query.userId != null ? eq(cashSessions.userId, query.userId) : undefined
  ].filter(Boolean)
  const where = conditions.length ? and(...conditions) : undefined

  const rows = await db
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

  return rows.map((r) => ({
    ...r,
    openingAmount: fromCents(r.openingAmount),
    closingAmount: r.closingAmount == null ? null : fromCents(r.closingAmount),
    expectedAmount: r.expectedAmount == null ? null : fromCents(r.expectedAmount),
    difference: r.difference == null ? null : fromCents(r.difference)
  }))
}
