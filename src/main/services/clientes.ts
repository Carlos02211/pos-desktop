import { and, asc, eq, sql } from 'drizzle-orm'
import type { CustomerInput, CustomerWithBalance } from '../../shared/types'
import type { CustomerRow } from '../db/schema'
import { creditAccounts, customers } from '../db/schema'
import type { DB } from '../db'
import { HttpError } from '../lib/http-error'
import { round2 } from '../lib/money'

/** Clientes con su saldo pendiente (suma de cuentas por cobrar abiertas). */
export function listCustomers(db: DB, includeInactive = false): CustomerWithBalance[] {
  const rows = db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      notes: customers.notes,
      active: customers.active,
      createdAt: customers.createdAt,
      openAccounts: sql<number>`count(case when ${creditAccounts.status} = 'OPEN' then 1 end)`,
      balance: sql<number>`coalesce(sum(case when ${creditAccounts.status} = 'OPEN' then ${creditAccounts.total} - ${creditAccounts.paid} else 0 end), 0)`
    })
    .from(customers)
    .leftJoin(creditAccounts, eq(creditAccounts.customerId, customers.id))
    .groupBy(customers.id)
    .orderBy(asc(customers.name))
    .all()
    .map((r) => ({ ...r, balance: round2(r.balance) }))

  return includeInactive ? rows : rows.filter((r) => r.active === 1)
}

export function getCustomer(db: DB, id: number): CustomerRow {
  const row = db.select().from(customers).where(eq(customers.id, id)).get()
  if (!row) throw new HttpError(404, 'Cliente no encontrado.')
  return row
}

export function createCustomer(db: DB, input: CustomerInput): CustomerRow {
  const name = input.name.trim()
  if (name.length < 2) throw new HttpError(400, 'El nombre del cliente es muy corto.')
  const [row] = db
    .insert(customers)
    .values({
      name,
      phone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      active: input.active === false ? 0 : 1
    })
    .returning()
    .all()
  return row
}

export function updateCustomer(db: DB, id: number, input: CustomerInput): CustomerRow {
  getCustomer(db, id)
  const name = input.name.trim()
  if (name.length < 2) throw new HttpError(400, 'El nombre del cliente es muy corto.')
  const [row] = db
    .update(customers)
    .set({
      name,
      phone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      active: input.active === false ? 0 : 1
    })
    .where(eq(customers.id, id))
    .returning()
    .all()
  return row
}

/** Baja de cliente = desactivación. No se permite si tiene cuentas abiertas. */
export function deactivateCustomer(db: DB, id: number): void {
  getCustomer(db, id)
  const open = db
    .select({ n: sql<number>`count(*)` })
    .from(creditAccounts)
    .where(and(eq(creditAccounts.customerId, id), eq(creditAccounts.status, 'OPEN')))
    .get()!
  if (open.n > 0) {
    throw new HttpError(409, 'El cliente tiene cuentas por cobrar abiertas.')
  }
  db.update(customers).set({ active: 0 }).where(eq(customers.id, id)).run()
}
