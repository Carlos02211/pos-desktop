import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Schema de la base de datos — Fase 1 (SQLite).
 *
 * Reglas de oro:
 *  - Todos los timestamps son Unix en segundos (integer). Compatible con SQLite y PostgreSQL.
 *  - Los precios se guardan como `real`. IVA incluido, precio fijo.
 *  - Soft delete via columna `active` — nunca se borra un producto/categoría/usuario
 *    con historial de ventas asociado.
 *
 * Para Fase 2 (PostgreSQL) se re-declara con `pgTable` manteniendo los mismos nombres
 * de columna; la lógica de negocio y las queries de Drizzle no cambian.
 */

const now = sql`(unixepoch())`

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(), // hash bcrypt
  role: text('role', { enum: ['ADMIN', 'COBRADOR'] }).notNull(),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now)
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  active: integer('active').notNull().default(1)
})

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  price: real('price').notNull(),
  categoryId: integer('category_id').references(() => categories.id),
  imagePath: text('image_path'), // ruta relativa dentro de userData/uploads/productos/
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now)
})

export const cashSessions = sqliteTable('cash_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  openedAt: integer('opened_at').notNull().default(now),
  closedAt: integer('closed_at'),
  openingAmount: real('opening_amount').notNull(),
  closingAmount: real('closing_amount'),
  expectedAmount: real('expected_amount'), // apertura + ventas en efectivo
  difference: real('difference'), // closingAmount - expectedAmount
  status: text('status', { enum: ['OPEN', 'CLOSED'] })
    .notNull()
    .default('OPEN')
})

export const sales = sqliteTable('sales', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cashSessionId: integer('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  total: real('total').notNull(),
  // CREDIT = venta a crédito ("fiado"): parte o nada se paga ahora, el resto abre una cuenta.
  paymentMethod: text('payment_method', { enum: ['CASH', 'CARD', 'TRANSFER', 'CREDIT'] }).notNull(),
  amountPaid: real('amount_paid'), // efectivo recibido (CASH) o abono inicial (CREDIT)
  change: real('change'), // solo si CASH
  ticketNumber: integer('ticket_number').notNull(), // folio secuencial por sesión de caja
  createdAt: integer('created_at').notNull().default(now)
})

export const saleItems = sqliteTable('sale_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id')
    .notNull()
    .references(() => sales.id),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  name: text('name').notNull(), // snapshot al momento de la venta
  price: real('price').notNull(), // snapshot al momento de la venta
  quantity: integer('quantity').notNull(),
  subtotal: real('subtotal').notNull()
})

/* ---- Módulo de cuentas por cobrar ("fiado") ---- */

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  notes: text('notes'),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now)
})

export const creditAccounts = sqliteTable('credit_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Venta que originó la cuenta (null si es una deuda registrada a mano en el futuro).
  saleId: integer('sale_id').references(() => sales.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  total: real('total').notNull(), // monto adeudado (después del abono inicial de la venta)
  paid: real('paid').notNull().default(0), // suma de abonos posteriores
  status: text('status', { enum: ['OPEN', 'PAID'] })
    .notNull()
    .default('OPEN'),
  createdAt: integer('created_at').notNull().default(now),
  closedAt: integer('closed_at')
})

export const creditPayments = sqliteTable('credit_payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  creditAccountId: integer('credit_account_id')
    .notNull()
    .references(() => creditAccounts.id),
  // Sesión de caja que recibió el abono (para el corte del turno).
  cashSessionId: integer('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  amount: real('amount').notNull(),
  paymentMethod: text('payment_method', { enum: ['CASH', 'CARD', 'TRANSFER'] }).notNull(),
  createdAt: integer('created_at').notNull().default(now)
})

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const license = sqliteTable('license', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fingerprint: text('fingerprint').notNull(), // SHA-256 del hardware
  key: text('key').notNull(),
  activatedAt: integer('activated_at').notNull().default(now),
  status: text('status', { enum: ['ACTIVE', 'REVOKED'] })
    .notNull()
    .default('ACTIVE')
})

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
export type CategoryRow = typeof categories.$inferSelect
export type ProductRow = typeof products.$inferSelect
export type CashSessionRow = typeof cashSessions.$inferSelect
export type SaleRow = typeof sales.$inferSelect
export type SaleItemRow = typeof saleItems.$inferSelect
export type CustomerRow = typeof customers.$inferSelect
export type CreditAccountRow = typeof creditAccounts.$inferSelect
export type CreditPaymentRow = typeof creditPayments.$inferSelect
export type ConfigRow = typeof config.$inferSelect
export type LicenseRow = typeof license.$inferSelect
