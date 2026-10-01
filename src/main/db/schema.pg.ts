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

export const products = pgTable(
  'products',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    unit: text('unit', { enum: ['PIEZA', 'KG'] })
      .notNull()
      .default('PIEZA'),
    categoryId: integer('category_id').references(() => categories.id),
    imagePath: text('image_path'),
    barcode: text('barcode'),
    // 1 = precio libre ("Varios", servicios): el cajero escribe el importe al cobrar.
    openPrice: integer('open_price').notNull().default(0),
    // Inventario (opcional por producto). Existencia en piezas o kg; puede quedar negativa si se
    // vendió algo que no estaba registrado (la venta nunca se bloquea por inventario).
    trackStock: integer('track_stock').notNull().default(0),
    stock: doublePrecision('stock').notNull().default(0),
    minStock: doublePrecision('min_stock'),
    // ANTICIPO = producto interno con el que se cobran los anticipos de encargos: no sale en el
    // catálogo ni se vende a mano (ver services/encargos.ts). Todo lo demás es NORMAL.
    kind: text('kind', { enum: ['NORMAL', 'ANTICIPO'] })
      .notNull()
      .default('NORMAL'),
    active: integer('active').notNull().default(1),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => [uniqueIndex('products_barcode_unique').on(t.barcode)]
)

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
    subtotal: integer('subtotal').notNull(),
    // Indicación para quien despacha ("sin chile", "bien dorado"); sale en el ticket.
    note: text('note'),
    // Cuándo se agregó la línea a una venta ya cobrada (cliente que olvidó algo); null = venta original.
    addedAt: integer('added_at')
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

/** Historial de inventario: cada entrada, ajuste (conteo) y venta de un producto con inventario. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ['ENTRY', 'ADJUST', 'SALE'] }).notNull(),
    // Cambio en la existencia (+ entra, − sale), en piezas o kg.
    quantity: doublePrecision('quantity').notNull(),
    stockAfter: doublePrecision('stock_after').notNull(),
    reason: text('reason'),
    saleId: integer('sale_id').references(() => sales.id),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [
    index('stock_movements_product_idx').on(t.productId),
    index('stock_movements_created_idx').on(t.createdAt)
  ]
)

/**
 * Opciones de un producto para elegir al venderlo ("Tipo de pollo": Natural / Adobado). Cada
 * grupo es de "elige uno" y obligatorio. `price` es lo que se suma al precio del producto
 * (0 = mismo precio). Soft delete: una opción vendida no se borra.
 */
export const productOptions = pgTable(
  'product_options',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    groupName: text('group_name').notNull(),
    name: text('name').notNull(),
    price: integer('price').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    active: integer('active').notNull().default(1)
  },
  (t) => [index('product_options_product_idx').on(t.productId)]
)

/**
 * Contenido de un paquete o presentación: qué productos lleva y cuánto de cada uno
 * ("Paquete familiar" = 1 Pollo + 1 Tortillas + 1 Arroz; "Medio pollo" = 0.5 Pollo).
 * Al venderlo se descuenta del inventario de cada componente.
 */
export const productComponents = pgTable(
  'product_components',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    componentId: integer('component_id')
      .notNull()
      .references(() => products.id),
    quantity: doublePrecision('quantity').notNull()
  },
  (t) => [
    uniqueIndex('product_components_unique').on(t.productId, t.componentId),
    index('product_components_component_idx').on(t.componentId)
  ]
)

/**
 * Encargos ("apártame 2 pollos para las 2"): el pedido se guarda con lo que lleva y, si dejan
 * anticipo, se cobra como una venta aparte (producto ANTICIPO). Al entregarlo se cobra como
 * venta normal y el anticipo se descuenta con un renglón negativo, así cortes y reportes
 * cuadran sin casos especiales.
 */
export const orders = pgTable(
  'orders',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // ENCARGO = para recoger a cierta hora. CUENTA = cuenta abierta (mesa): se le van agregando
    // productos y se cobra al final; `pickupAt` es cuándo se abrió.
    type: text('type', { enum: ['ENCARGO', 'CUENTA'] })
      .notNull()
      .default('ENCARGO'),
    customerName: text('customer_name').notNull(),
    phone: text('phone'),
    pickupAt: integer('pickup_at').notNull(), // Unix (s): cuándo pasan por él
    notes: text('notes'),
    // Renglones del carrito (CartLineInput[] en JSON): se validan otra vez al entregarlo.
    items: text('items').notNull(),
    total: integer('total').notNull(), // centavos, con los precios del día en que se encargó
    // Sube con cada cambio de renglones: quien cobra o corrige con una copia vieja recibe 409
    // (otra caja agregó algo mientras tanto y se perdería).
    version: integer('version').notNull().default(1),
    deposit: integer('deposit').notNull().default(0), // anticipo en centavos
    depositSaleId: integer('deposit_sale_id').references(() => sales.id),
    status: text('status', { enum: ['PENDING', 'DELIVERED', 'CANCELLED'] })
      .notNull()
      .default('PENDING'),
    saleId: integer('sale_id').references(() => sales.id), // venta con la que se entregó
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull().default(now),
    closedAt: integer('closed_at')
  },
  (t) => [index('orders_status_idx').on(t.status), index('orders_pickup_idx').on(t.pickupAt)]
)

export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const license = pgTable(
  'license',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    fingerprint: text('fingerprint').notNull(),
    key: text('key').notNull(),
    activatedAt: integer('activated_at').notNull().default(now),
    status: text('status', { enum: ['ACTIVE', 'REVOKED'] })
      .notNull()
      .default('ACTIVE')
  },
  (t) => [
    uniqueIndex('license_one_active')
      .on(sql`(1)`)
      .where(sql`${t.status} = 'ACTIVE'`)
  ]
)
