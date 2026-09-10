import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { DashboardData, OpenSessionInfo, SaleListItem } from '../../shared/types'
import type { DB } from '../db'
import { cashSessions, customers, saleItems, sales, users } from '../db/schema'
import { fromCents } from '../lib/money'
import { businessOffsetMinutes, dayStartUnix, nowParts } from '../lib/timezone'
import { getConfigMap } from './config'
import { totalReceivable } from './cuentas'

/** Indicadores del día en curso (zona horaria del negocio, `config.business_utc_offset`). */
export async function getDashboard(db: DB): Promise<DashboardData> {
  const offset = businessOffsetMinutes(await getConfigMap(db))
  const t0 = nowParts(offset)
  const from = dayStartUnix(t0.year, t0.month, t0.day, offset)
  const to = from + 86_400 - 1
  const inToday = and(gte(sales.createdAt, from), lte(sales.createdAt, to))

  const [totals] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${sales.total}), 0)`,
      cash: sql<number>`coalesce(sum(case when ${sales.paymentMethod}='CASH' then ${sales.total} else 0 end),0)`,
      card: sql<number>`coalesce(sum(case when ${sales.paymentMethod}='CARD' then ${sales.total} else 0 end),0)`,
      transfer: sql<number>`coalesce(sum(case when ${sales.paymentMethod}='TRANSFER' then ${sales.total} else 0 end),0)`
    })
    .from(sales)
    .where(inToday)

  const openSessions: OpenSessionInfo[] = (
    await db
      .select({
        cashSessionId: cashSessions.id,
        userId: cashSessions.userId,
        userName: users.username,
        openedAt: cashSessions.openedAt,
        openingAmount: cashSessions.openingAmount
      })
      .from(cashSessions)
      .innerJoin(users, eq(users.id, cashSessions.userId))
      .where(eq(cashSessions.status, 'OPEN'))
      .orderBy(cashSessions.openedAt)
  ).map((r) => ({ ...r, openingAmount: fromCents(r.openingAmount) }))

  const recentSales: SaleListItem[] = (
    await db
      .select({
        id: sales.id,
        ticketNumber: sales.ticketNumber,
        cashSessionId: sales.cashSessionId,
        userId: sales.userId,
        userName: users.username,
        total: sales.total,
        paymentMethod: sales.paymentMethod,
        amountPaid: sales.amountPaid,
        change: sales.change,
        customerName: customers.name,
        createdAt: sales.createdAt,
        itemCount: sql<number>`(select coalesce(count(*),0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`
      })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.userId))
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .orderBy(desc(sales.createdAt), desc(sales.id))
      .limit(5)
  ).map((r) => ({
    ...r,
    total: fromCents(Number(r.total)),
    amountPaid: r.amountPaid == null ? null : fromCents(Number(r.amountPaid)),
    change: r.change == null ? null : fromCents(Number(r.change)),
    itemCount: Number(r.itemCount)
  }))

  return {
    date: from,
    totalSales: fromCents(Number(totals.total)),
    totalTransactions: Number(totals.count),
    byPaymentMethod: {
      CASH: fromCents(Number(totals.cash)),
      CARD: fromCents(Number(totals.card)),
      TRANSFER: fromCents(Number(totals.transfer))
    },
    cuentasPorCobrar: await totalReceivable(db),
    openSessions,
    recentSales
  }
}
