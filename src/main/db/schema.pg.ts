import { sql } from 'drizzle-orm'
import { doublePrecision, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Schema de la base de datos — dialecto PostgreSQL (Fase 2 / servidor en red local).
 *
 * Espejo EXACTO de `schema.sqlite.ts`: mismos nombres de tabla y columna, mismos
 * tipos lógicos. Las diferencias son sólo de dialecto:
 *  - `integer().primaryKey().generatedAlwaysAsIdentity()` en vez de `autoIncrement`.
 *  - El dinero es `integer` de centavos (igual que SQLite). `quantity` (kg) sí es float.
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
  price: integer('price').notNull(),
  unit: text('unit', { enum: ['PIEZA', 'KG'] })
    .notNull()
    .default('PIEZA'),
  categoryId: integer('category_id').references(() => categories.id),
  imagePath: text('image_path'),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now)
})

export const cashSessions = pgTable(
  'cash_sessions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    openedAt: integer('opened_at').notNull().default(now),
    closedAt: integer('closed_at'),
    openingAmount: integer('opening_amount').notNull(),
    closingAmount: integer('closing_amount'),
    expectedAmount: integer('expected_amount'),
    difference: integer('difference'),
    status: text('status', { enum: ['OPEN', 'CLOSED'] })
      .notNull()
      .default('OPEN')
  },
  (t) => [
    uniqueIndex('cash_sessions_one_open_per_user')
      .on(t.userId)
      .where(sql`${t.status} = 'OPEN'`),
    index('cash_sessions_user_idx').on(t.userId),
    index('cash_sessions_status_idx').on(t.status)
  ]
)

export const sales = pgTable(
  'sales',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    cashSessionId: integer('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    total: integer('total').notNull(),
    paymentMethod: text('payment_method', {
      enum: ['CASH', 'CARD', 'TRANSFER', 'CREDIT']
    }).notNull(),
    amountPaid: integer('amount_paid'),
    change: integer('change'),
    ticketNumber: integer('ticket_number').notNull(),
    customerId: integer('customer_id').references(() => customers.id),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [
    uniqueIndex('sales_ticket_per_session').on(t.cashSessionId, t.ticketNumber),
    index('sales_session_idx').on(t.cashSessionId),
    index('sales_customer_idx').on(t.customerId),
    index('sales_created_at_idx').on(t.createdAt),
    index('sales_payment_method_idx').on(t.paymentMethod)
  ]
)

export const saleItems = pgTable(
  'sale_items',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    originalPrice: integer('original_price'),
    unit: text('unit', { enum: ['PIEZA', 'KG'] })
      .notNull()
      .default('PIEZA'),
    quantity: doublePrecision('quantity').notNull(),
    subtotal: integer('subtotal').notNull()
  },
  (t) => [
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_product_idx').on(t.productId)
  ]
)

/* ---- Módulo de cuentas por cobrar ("fiado") ---- */

export const customers = pgTable('customers', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  phone: text('phone'),
  notes: text('notes'),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now)
})

export const creditAccounts = pgTable(
  'credit_accounts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    saleId: integer('sale_id').references(() => sales.id),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    total: integer('total').notNull(),
    paid: integer('paid').notNull().default(0),
    status: text('status', { enum: ['OPEN', 'PAID'] })
      .notNull()
      .default('OPEN'),
    createdAt: integer('created_at').notNull().default(now),
    closedAt: integer('closed_at')
  },
  (t) => [
    index('credit_accounts_customer_idx').on(t.customerId),
    index('credit_accounts_status_idx').on(t.status),
    index('credit_accounts_sale_idx').on(t.saleId)
  ]
)

export const creditPayments = pgTable(
  'credit_payments',
  {
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
    amount: integer('amount').notNull(),
    paymentMethod: text('payment_method', { enum: ['CASH', 'CARD', 'TRANSFER'] }).notNull(),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [
    index('credit_payments_account_idx').on(t.creditAccountId),
    index('credit_payments_session_idx').on(t.cashSessionId)
  ]
)

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    cashSessionId: integer('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ['IN', 'OUT'] }).notNull(),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('cash_movements_session_idx').on(t.cashSessionId)]
)

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
