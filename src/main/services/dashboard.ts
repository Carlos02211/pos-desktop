import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { DashboardData, OpenSessionInfo, SaleListItem } from '../../shared/types'
import type { DB } from '../db'
import { cashSessions, saleItems, sales, users } from '../db/schema'
import { round2 } from '../lib/money'
import { totalReceivable } from './cuentas'

/** Indicadores del día en curso (hora local del servidor). */
export function getDashboard(db: DB): DashboardData {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const from = Math.floor(start.getTime() / 1000)
  const to = from + 86_400 - 1
  const inToday = and(gte(sales.createdAt, from), lte(sales.createdAt, to))

  const totals = db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${sales.total}), 0)`,
      cash: sql<number>`coalesce(sum(case when ${sales.paymentMethod}='CASH' then ${sales.total} else 0 end),0)`,
      card: sql<number>`coalesce(sum(case when ${sales.paymentMethod}='CARD' then ${sales.total} else 0 end),0)`,
      transfer: sql<number>`coalesce(sum(case when ${sales.paymentMethod}='TRANSFER' then ${sales.total} else 0 end),0)`
    })
    .from(sales)
    .where(inToday)
    .get()!

  const openSessions: OpenSessionInfo[] = db
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
    .all()

  const recentSales: SaleListItem[] = db
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
      createdAt: sales.createdAt,
      itemCount: sql<number>`(select coalesce(sum(${saleItems.quantity}),0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.userId))
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(5)
    .all()

  return {
    date: from,
    totalSales: round2(totals.total),
    totalTransactions: totals.count,
    byPaymentMethod: {
      CASH: round2(totals.cash),
      CARD: round2(totals.card),
      TRANSFER: round2(totals.transfer)
    },
    cuentasPorCobrar: totalReceivable(db),
    openSessions,
    recentSales
  }
}
