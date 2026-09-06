import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type {
  AbonoInput,
  CreditAccountDetail,
  CreditAccountListItem,
  CreditQuery
} from '../../shared/types'
import type { CreditAccountRow } from '../db/schema'
import { creditAccounts, creditPayments, customers, sales, users } from '../db/schema'
import type { DB } from '../db'
import { HttpError } from '../lib/http-error'
import { round2 } from '../lib/money'
import { getActiveSession } from './caja'
import { getSaleWithItems } from './ventas'

const listColumns = {
  id: creditAccounts.id,
  customerId: creditAccounts.customerId,
  customerName: customers.name,
  saleId: creditAccounts.saleId,
  ticketNumber: sales.ticketNumber,
  total: creditAccounts.total,
  paid: creditAccounts.paid,
  status: creditAccounts.status,
  createdAt: creditAccounts.createdAt,
  closedAt: creditAccounts.closedAt
}

function withBalance<T extends { total: number; paid: number }>(row: T): T & { balance: number } {
  return { ...row, balance: round2(row.total - row.paid) }
}

/** Crea la cuenta por cobrar de una venta a crédito. Se llama dentro de la transacción de venta. */
export function openCreditAccount(
  db: DB,
  params: { saleId: number; customerId: number; userId: number; amount: number }
): CreditAccountRow {
  const customer = db.select().from(customers).where(eq(customers.id, params.customerId)).get()
  if (!customer || customer.active !== 1) {
    throw new HttpError(400, 'El cliente indicado no existe o está inactivo.')
  }
  const [row] = db
    .insert(creditAccounts)
    .values({
      saleId: params.saleId,
      customerId: params.customerId,
      userId: params.userId,
      total: round2(params.amount),
      paid: 0,
      status: 'OPEN'
    })
    .returning()
    .all()
  return row
}

export function listCreditAccounts(db: DB, query: CreditQuery): CreditAccountListItem[] {
  const conditions = [
    query.status && query.status !== 'all' ? eq(creditAccounts.status, query.status) : undefined,
    query.customerId != null ? eq(creditAccounts.customerId, query.customerId) : undefined,
    query.from != null ? gte(creditAccounts.createdAt, query.from) : undefined,
    query.to != null ? lte(creditAccounts.createdAt, query.to) : undefined
  ].filter(Boolean)
  const where = conditions.length ? and(...conditions) : undefined

  return (
    db
      .select(listColumns)
      .from(creditAccounts)
      .innerJoin(customers, eq(customers.id, creditAccounts.customerId))
      .leftJoin(sales, eq(sales.id, creditAccounts.saleId))
      .where(where)
      // Primero las abiertas, luego por fecha descendente.
      .orderBy(
        sql`case when ${creditAccounts.status} = 'OPEN' then 0 else 1 end`,
        desc(creditAccounts.createdAt)
      )
      .all()
      .map(withBalance)
  )
}

export function getCreditAccountDetail(db: DB, id: number): CreditAccountDetail {
  const head = db
    .select({ ...listColumns, userName: users.username })
    .from(creditAccounts)
    .innerJoin(customers, eq(customers.id, creditAccounts.customerId))
    .innerJoin(users, eq(users.id, creditAccounts.userId))
    .leftJoin(sales, eq(sales.id, creditAccounts.saleId))
    .where(eq(creditAccounts.id, id))
    .get()
  if (!head) throw new HttpError(404, 'Cuenta no encontrada.')

  const payments = db
    .select({
      id: creditPayments.id,
      creditAccountId: creditPayments.creditAccountId,
      cashSessionId: creditPayments.cashSessionId,
      userId: creditPayments.userId,
      userName: users.username,
      amount: creditPayments.amount,
      paymentMethod: creditPayments.paymentMethod,
      createdAt: creditPayments.createdAt
    })
    .from(creditPayments)
    .innerJoin(users, eq(users.id, creditPayments.userId))
    .where(eq(creditPayments.creditAccountId, id))
    .orderBy(creditPayments.createdAt)
    .all()

  return {
    ...withBalance(head),
    sale: head.saleId ? getSaleWithItems(db, head.saleId) : null,
    payments
  }
}

/**
 * Registra un abono (pago parcial o total) a una cuenta.
 * Requiere caja abierta: el dinero entra al turno del cobrador.
 */
export function addAbono(
  db: DB,
  accountId: number,
  userId: number,
  input: AbonoInput
): CreditAccountDetail {
  const session = getActiveSession(db, userId)
  if (!session) throw new HttpError(409, 'Abre caja para recibir un abono.')

  db.transaction((tx) => {
    const account = tx.select().from(creditAccounts).where(eq(creditAccounts.id, accountId)).get()
    if (!account) throw new HttpError(404, 'Cuenta no encontrada.')
    if (account.status === 'PAID') throw new HttpError(409, 'La cuenta ya está liquidada.')

    const balance = round2(account.total - account.paid)
    const amount = round2(input.amount)
    if (amount <= 0) throw new HttpError(400, 'El abono debe ser mayor a cero.')
    if (amount > balance) {
      throw new HttpError(400, `El abono supera el saldo pendiente (${balance.toFixed(2)}).`)
    }

    tx.insert(creditPayments)
      .values({
        creditAccountId: accountId,
        cashSessionId: session.id,
        userId,
        amount,
        paymentMethod: input.paymentMethod
      })
      .run()

    const paid = round2(account.paid + amount)
    const settled = paid >= account.total
    tx.update(creditAccounts)
      .set({
        paid,
        status: settled ? 'PAID' : 'OPEN',
        closedAt: settled ? Math.floor(Date.now() / 1000) : null
      })
      .where(eq(creditAccounts.id, accountId))
      .run()
  })

  return getCreditAccountDetail(db, accountId)
}

/** Total adeudado: saldo de todas las cuentas abiertas. */
export function totalReceivable(db: DB): number {
  const row = db
    .select({
      balance: sql<number>`coalesce(sum(${creditAccounts.total} - ${creditAccounts.paid}), 0)`
    })
    .from(creditAccounts)
    .where(eq(creditAccounts.status, 'OPEN'))
    .get()!
  return round2(row.balance)
}
