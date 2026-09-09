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
import { lockRow, withTx } from '../db/tx'
import { HttpError } from '../lib/http-error'
import { fromCents, toCents } from '../lib/money'
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

/** `total`/`paid` vienen en centavos; salen en pesos junto con el `balance`. */
function withBalance<T extends { total: number; paid: number }>(row: T): T & { balance: number } {
  return {
    ...row,
    total: fromCents(row.total),
    paid: fromCents(row.paid),
    balance: fromCents(row.total - row.paid)
  }
}

/** Crea la cuenta por cobrar de una venta a crédito. Se llama dentro de la transacción de venta. */
export async function openCreditAccount(
  db: DB,
  params: { saleId: number; customerId: number; userId: number; amount: number }
): Promise<CreditAccountRow> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, params.customerId))
    .limit(1)
  if (!customer || customer.active !== 1) {
    throw new HttpError(400, 'El cliente indicado no existe o está inactivo.')
  }
  const [row] = await db
    .insert(creditAccounts)
    .values({
      saleId: params.saleId,
      customerId: params.customerId,
      userId: params.userId,
      total: toCents(params.amount),
      paid: 0,
      status: 'OPEN'
    })
    .returning()
  return row
}

export async function listCreditAccounts(
  db: DB,
  query: CreditQuery
): Promise<CreditAccountListItem[]> {
  const conditions = [
    query.status && query.status !== 'all' ? eq(creditAccounts.status, query.status) : undefined,
    query.customerId != null ? eq(creditAccounts.customerId, query.customerId) : undefined,
    query.from != null ? gte(creditAccounts.createdAt, query.from) : undefined,
    query.to != null ? lte(creditAccounts.createdAt, query.to) : undefined
  ].filter(Boolean)
  const where = conditions.length ? and(...conditions) : undefined

  return (
    (
      await db
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
    ).map(withBalance)
  )
}

export async function getCreditAccountDetail(db: DB, id: number): Promise<CreditAccountDetail> {
  const [head] = await db
    .select({ ...listColumns, userName: users.username })
    .from(creditAccounts)
    .innerJoin(customers, eq(customers.id, creditAccounts.customerId))
    .innerJoin(users, eq(users.id, creditAccounts.userId))
    .leftJoin(sales, eq(sales.id, creditAccounts.saleId))
    .where(eq(creditAccounts.id, id))
    .limit(1)
  if (!head) throw new HttpError(404, 'Cuenta no encontrada.')

  const payments = (
    await db
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
  ).map((p) => ({ ...p, amount: fromCents(p.amount) }))

  return {
    ...withBalance(head),
    sale: head.saleId ? await getSaleWithItems(db, head.saleId) : null,
    payments
  }
}

/**
 * Registra un abono (pago parcial o total) a una cuenta.
 * Requiere caja abierta: el dinero entra al turno del cobrador.
 */
export async function addAbono(
  db: DB,
  accountId: number,
  userId: number,
  input: AbonoInput
): Promise<CreditAccountDetail> {
  await withTx(db, async (tx) => {
    const session = await getActiveSession(tx, userId)
    if (!session) throw new HttpError(409, 'Abre caja para recibir un abono.')

    // Lock de la cuenta: dos abonos simultáneos a la misma cuenta se serializan
    // (si no, el segundo UPDATE pisaría el `paid` del primero — lost update).
    await lockRow(tx, 'credit_accounts', accountId)

    const [account] = await tx
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.id, accountId))
      .limit(1)
    if (!account) throw new HttpError(404, 'Cuenta no encontrada.')
    if (account.status === 'PAID') throw new HttpError(409, 'La cuenta ya está liquidada.')

    const balanceCents = account.total - account.paid
    const amountCents = toCents(input.amount)
    if (amountCents <= 0) throw new HttpError(400, 'El abono debe ser mayor a cero.')
    if (amountCents > balanceCents) {
      throw new HttpError(
        400,
        `El abono supera el saldo pendiente (${fromCents(balanceCents).toFixed(2)}).`
      )
    }

    await tx.insert(creditPayments).values({
      creditAccountId: accountId,
      cashSessionId: session.id,
      userId,
      amount: amountCents,
      paymentMethod: input.paymentMethod
    })

    const paidCents = account.paid + amountCents
    const settled = paidCents >= account.total
    await tx
      .update(creditAccounts)
      .set({
        paid: paidCents,
        status: settled ? 'PAID' : 'OPEN',
        closedAt: settled ? Math.floor(Date.now() / 1000) : null
      })
      .where(eq(creditAccounts.id, accountId))
  })

  return getCreditAccountDetail(db, accountId)
}

/** Total adeudado: saldo de todas las cuentas abiertas. */
export async function totalReceivable(db: DB): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${creditAccounts.total} - ${creditAccounts.paid}), 0)`
    })
    .from(creditAccounts)
    .where(eq(creditAccounts.status, 'OPEN'))
  return fromCents(Number(row.balance))
}
