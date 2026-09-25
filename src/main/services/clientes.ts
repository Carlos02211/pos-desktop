import { and, asc, eq, sql } from 'drizzle-orm'
import type { CustomerInput, CustomerWithBalance } from '../../shared/types'
import type { CustomerRow } from '../db/schema'
import { creditAccounts, customers } from '../db/schema'
import type { DB } from '../db'
import { HttpError } from '../lib/http-error'
import { fromCents } from '../lib/money'

/** Clientes con su saldo pendiente (suma de cuentas por cobrar abiertas). */
export async function listCustomers(
  db: DB,
  includeInactive = false
): Promise<CustomerWithBalance[]> {
  const rows = (
    await db
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
  ).map((r) => ({
    ...r,
    openAccounts: Number(r.openAccounts),
    balance: fromCents(Number(r.balance))
  }))

  return includeInactive ? rows : rows.filter((r) => r.active === 1)
}

export async function getCustomer(db: DB, id: number): Promise<CustomerRow> {
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
  if (!row) throw new HttpError(404, 'Cliente no encontrado.')
  return row
}

export async function createCustomer(db: DB, input: CustomerInput): Promise<CustomerRow> {
  const name = input.name.trim()
  if (name.length < 2) throw new HttpError(400, 'El nombre del cliente es muy corto.')
  const [row] = await db
    .insert(customers)
    .values({
      name,
      phone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      active: input.active === false ? 0 : 1
    })
    .returning()
  return row
}

export async function updateCustomer(
  db: DB,
  id: number,
  input: CustomerInput
): Promise<CustomerRow> {
  await getCustomer(db, id)
  const name = input.name.trim()
  if (name.length < 2) throw new HttpError(400, 'El nombre del cliente es muy corto.')
  const [row] = await db
    .update(customers)
    .set({
      name,
      phone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      active: input.active === false ? 0 : 1
    })
    .where(eq(customers.id, id))
    .returning()
  return row
}

/** Baja de cliente = desactivación. No se permite si tiene cuentas abiertas. */
export async function deactivateCustomer(db: DB, id: number): Promise<void> {
  await getCustomer(db, id)
  const [open] = await db
    .select({ n: sql<number>`count(*)` })
    .from(creditAccounts)
    .where(and(eq(creditAccounts.customerId, id), eq(creditAccounts.status, 'OPEN')))
  if (Number(open.n) > 0) {
    throw new HttpError(409, 'El cliente tiene cuentas por cobrar abiertas.')
  }
  await db.update(customers).set({ active: 0 }).where(eq(customers.id, id))
}
