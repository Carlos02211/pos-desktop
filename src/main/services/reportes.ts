import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type {
  PaymentBreakdown,
  ReportBucket,
  ReportType,
  SalesReport,
  TopProduct
} from '../../shared/types'
import type { DB } from '../db'
import { saleItems, sales } from '../db/schema'
import { HttpError } from '../lib/http-error'
import { fromCents } from '../lib/money'
import { businessOffsetMinutes, dayStartUnix, partsFor } from '../lib/timezone'
import { getConfigMap } from './config'

export interface ReportParams {
  fecha?: string // YYYY-MM-DD  (diario / inicio de semana)
  inicio?: string // YYYY-MM-DD (semanal)
  mes?: number // 1-12
  anio?: number
}

function dayStart(dateStr: string, offset: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) throw new HttpError(400, 'Fecha inválida (usa YYYY-MM-DD).')
  return dayStartUnix(Number(m[1]), Number(m[2]) - 1, Number(m[3]), offset)
}

/** Rango [from, to] en segundos Unix para el tipo de reporte, en la zona del negocio. */
export function periodBounds(
  type: ReportType,
  params: ReportParams,
  offset: number
): { from: number; to: number } {
  if (type === 'diario') {
    if (!params.fecha) throw new HttpError(400, 'Falta el parámetro "fecha".')
    const from = dayStart(params.fecha, offset)
    return { from, to: from + 86_400 - 1 }
  }
  if (type === 'semanal') {
    const start = params.inicio ?? params.fecha
    if (!start) throw new HttpError(400, 'Falta el parámetro "inicio".')
    const from = dayStart(start, offset)
    return { from, to: from + 7 * 86_400 - 1 }
  }
  // mensual
  if (!params.mes || !params.anio) throw new HttpError(400, 'Faltan los parámetros "mes" y "anio".')
  if (params.mes < 1 || params.mes > 12) throw new HttpError(400, 'El mes debe estar entre 1 y 12.')
  const from = dayStartUnix(params.anio, params.mes - 1, 1, offset)
  const to = dayStartUnix(params.anio, params.mes, 1, offset) - 1
  return { from, to }
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function emptyBreakdown(): PaymentBreakdown {
  return { CASH: 0, CARD: 0, TRANSFER: 0 }
}

/** `rows[].total` en CENTAVOS; los buckets devueltos ya vienen en pesos. */
function bucketsFor(
  type: ReportType,
  from: number,
  to: number,
  rows: { total: number; createdAt: number }[],
  offset: number
): ReportBucket[] {
  const map = new Map<string, ReportBucket>()
  const dayKey = (unix: number): string => {
    const p = partsFor(unix, offset)
    return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}`
  }

  if (type === 'diario') {
    for (let h = 0; h < 24; h++) map.set(pad2(h), { label: `${pad2(h)}:00`, total: 0, count: 0 })
    for (const r of rows) {
      const key = pad2(partsFor(r.createdAt, offset).hour)
      const b = map.get(key)!
      b.total += r.total
      b.count += 1
    }
  } else {
    // semanal / mensual: un tramo por día del rango
    for (let t = from; t <= to; t += 86_400) {
      const key = dayKey(t)
      map.set(key, { label: key, total: 0, count: 0 })
    }
    for (const r of rows) {
      const b = map.get(dayKey(r.createdAt))
      if (b) {
        b.total += r.total
        b.count += 1
      }
    }
  }
  return [...map.values()].map((b) => ({ ...b, total: fromCents(b.total) }))
}

export async function buildReport(
  db: DB,
  type: ReportType,
  params: ReportParams
): Promise<SalesReport> {
  const offset = businessOffsetMinutes(await getConfigMap(db))
  const { from, to } = periodBounds(type, params, offset)
  const inPeriod = and(gte(sales.createdAt, from), lte(sales.createdAt, to))

  const rows = await db
    .select({ total: sales.total, paymentMethod: sales.paymentMethod, createdAt: sales.createdAt })
    .from(sales)
    .where(inPeriod)

  const centsByMethod = emptyBreakdown()
  let totalCents = 0
  let creditCents = 0
  for (const r of rows) {
    totalCents += r.total
    if (r.paymentMethod === 'CREDIT') {
      creditCents += r.total
    } else {
      centsByMethod[r.paymentMethod] += r.total
    }
  }
  const byPaymentMethod: PaymentBreakdown = {
    CASH: fromCents(centsByMethod.CASH),
    CARD: fromCents(centsByMethod.CARD),
    TRANSFER: fromCents(centsByMethod.TRANSFER)
  }

  const topProducts: TopProduct[] = (
    await db
      .select({
        productId: saleItems.productId,
        name: saleItems.name,
        quantity: sql<number>`sum(${saleItems.quantity})`,
        revenue: sql<number>`sum(${saleItems.subtotal})`
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(inPeriod)
      .groupBy(saleItems.productId, saleItems.name)
      .orderBy(desc(sql`sum(${saleItems.subtotal})`))
      .limit(5)
  ).map((p) => ({ ...p, quantity: Number(p.quantity), revenue: fromCents(Number(p.revenue)) }))

  return {
    type,
    from,
    to,
    totalSales: fromCents(totalCents),
    totalTransactions: rows.length,
    byPaymentMethod,
    creditExtended: fromCents(creditCents),
    topProducts,
    buckets: bucketsFor(type, from, to, rows, offset)
  }
}

export interface ReportSaleRow {
  id: number
  ticketNumber: number
  createdAt: number
  userName: string
  paymentMethod: string
  itemCount: number
  total: number
}

/** Detalle plano de ventas del período (para las exportaciones). */
export async function salesInPeriod(db: DB, from: number, to: number): Promise<ReportSaleRow[]> {
  return (
    await db
      .select({
        id: sales.id,
        ticketNumber: sales.ticketNumber,
        createdAt: sales.createdAt,
        userName: sql<string>`(select username from users where users.id = ${sales.userId})`,
        paymentMethod: sales.paymentMethod,
        itemCount: sql<number>`(select coalesce(count(*),0) from ${saleItems} where ${saleItems.saleId} = ${sales.id})`,
        total: sales.total
      })
      .from(sales)
      .where(and(gte(sales.createdAt, from), lte(sales.createdAt, to)))
      .orderBy(sales.createdAt)
  ).map((r) => ({ ...r, itemCount: Number(r.itemCount), total: fromCents(Number(r.total)) }))
}
