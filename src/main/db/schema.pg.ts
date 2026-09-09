import { sql } from 'drizzle-orm'
import { doublePrecision, integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Schema de la base de datos — dialecto PostgreSQL (Fase 2 / servidor en red local).
 *
 * Espejo EXACTO de `schema.sqlite.ts`: mismos nombres de tabla y columna, mismos
 * tipos lógicos. Las diferencias son sólo de dialecto:
 *  - `integer().primaryKey().generatedAlwaysAsIdentity()` en vez de `autoIncrement`.
 *  - `doublePrecision` (float8) para dinero — equivale al `real` de SQLite (también float8).
 *  - `active` sigue siendo `integer` 0/1 (no boolean) para no tocar la lógica de negocio.
 *  - timestamps: `integer` Unix en segundos, igual que en SQLite.
 *
 * Si cambias este archivo, cambia también `schema.sqlite.ts` y regenera ambas
 * carpetas de migraciones (`pnpm db:generate` y `pnpm db:generate:pg`).
 */

const now = sql`(extract(epoch from now())::int)`

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(), // hash bcrypt
  role: text('role', { enum: ['ADMIN', 'COBRADOR'] }).notNull(),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now)
})

export const categories = pgTable('categories', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull().unique(),
  active: integer('active').notNull().default(1)
})

export const products = pgTable('products', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  price: doublePrecision('price').notNull(),
  unit: text('unit', { enum: ['PIEZA', 'KG'] })
    .notNull()
    .default('PIEZA'),
  categoryId: integer('category_id').references(() => categories.id),
  imagePath: text('image_path'),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now)
})

export const cashSessions = pgTable('cash_sessions', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  openedAt: integer('opened_at').notNull().default(now),
  closedAt: integer('closed_at'),
  openingAmount: doublePrecision('opening_amount').notNull(),
  closingAmount: doublePrecision('closing_amount'),
  expectedAmount: doublePrecision('expected_amount'),
  difference: doublePrecision('difference'),
  status: text('status', { enum: ['OPEN', 'CLOSED'] })
    .notNull()
    .default('OPEN')
})

export const sales = pgTable('sales', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  cashSessionId: integer('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  total: doublePrecision('total').notNull(),
  paymentMethod: text('payment_method', {
    enum: ['CASH', 'CARD', 'TRANSFER', 'CREDIT']
  }).notNull(),
  amountPaid: doublePrecision('amount_paid'),
  change: doublePrecision('change'),
  ticketNumber: integer('ticket_number').notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  createdAt: integer('created_at').notNull().default(now)
})

export const saleItems = pgTable('sale_items', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  saleId: integer('sale_id')
    .notNull()
    .references(() => sales.id),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  name: text('name').notNull(),
  price: doublePrecision('price').notNull(),
  originalPrice: doublePrecision('original_price'),
  unit: text('unit', { enum: ['PIEZA', 'KG'] })
    .notNull()
    .default('PIEZA'),
  quantity: doublePrecision('quantity').notNull(),
  subtotal: doublePrecision('subtotal').notNull()
})

/* ---- Módulo de cuentas por cobrar ("fiado") ---- */

export const customers = pgTable('customers', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  phone: text('phone'),
  notes: text('notes'),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now)
})

export const creditAccounts = pgTable('credit_accounts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  saleId: integer('sale_id').references(() => sales.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  total: doublePrecision('total').notNull(),
  paid: doublePrecision('paid').notNull().default(0),
  status: text('status', { enum: ['OPEN', 'PAID'] })
    .notNull()
    .default('OPEN'),
  createdAt: integer('created_at').notNull().default(now),
  closedAt: integer('closed_at')
})

export const creditPayments = pgTable('credit_payments', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  creditAccountId: integer('credit_account_id')
    .notNull()
    .references(() => creditAccounts.id),
  cashSessionId: integer('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  amount: doublePrecision('amount').notNull(),
  paymentMethod: text('payment_method', { enum: ['CASH', 'CARD', 'TRANSFER'] }).notNull(),
  createdAt: integer('created_at').notNull().default(now)
})

export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const license = pgTable('license', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  fingerprint: text('fingerprint').notNull(),
  key: text('key').notNull(),
  activatedAt: integer('activated_at').notNull().default(now),
  status: text('status', { enum: ['ACTIVE', 'REVOKED'] })
    .notNull()
    .default('ACTIVE')
})
