import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Schema de la base de datos — dialecto SQLite (Fase 1 / Electron de escritorio).
 *
 * Reglas de oro:
 *  - Todos los timestamps son Unix en segundos (integer). Compatible con SQLite y PostgreSQL.
 *  - El dinero se guarda como enteros de CENTAVOS (integer). Nunca coma flotante.
 *    La conversión a/desde pesos ocurre en el borde HTTP (ver src/main/lib/money.ts).
 *  - Soft delete via columna `active` — nunca se borra un producto/categoría/usuario
 *    con historial de ventas asociado.
 *
 * El espejo en PostgreSQL (Fase 2 / servidor en red) vive en `schema.pg.ts` con los
 * MISMOS nombres de tabla y columna. `schema.ts` reexporta el dialecto activo según
 * `DATABASE_URL`, de modo que la lógica de negocio y las queries de Drizzle no cambian.
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

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    // PIEZA = cantidad entera (default). KG = se vende por peso, cantidad en kg (admite decimales).
    unit: text('unit', { enum: ['PIEZA', 'KG'] })
      .notNull()
      .default('PIEZA'),
    categoryId: integer('category_id').references(() => categories.id),
    imagePath: text('image_path'), // ruta relativa dentro de userData/uploads/productos/
    // Código de barras (EAN/UPC o interno). Opcional; NULL no choca con el índice único.
    barcode: text('barcode'),
    // 1 = precio libre ("Varios", servicios): el cajero escribe el importe al cobrar.
    openPrice: integer('open_price').notNull().default(0),
    // Inventario (opcional por producto). Existencia en piezas o kg; puede quedar negativa si se
    // vendió algo que no estaba registrado (la venta nunca se bloquea por inventario).
    trackStock: integer('track_stock').notNull().default(0),
    stock: real('stock').notNull().default(0),
    minStock: real('min_stock'),
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

export const cashSessions = sqliteTable(
  'cash_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    openedAt: integer('opened_at').notNull().default(now),
    closedAt: integer('closed_at'),
    openingAmount: integer('opening_amount').notNull(),
    closingAmount: integer('closing_amount'),
    expectedAmount: integer('expected_amount'), // apertura + ventas en efectivo
    difference: integer('difference'), // closingAmount - expectedAmount
    status: text('status', { enum: ['OPEN', 'CLOSED'] })
      .notNull()
      .default('OPEN')
  },
  (t) => [
    // Como mucho una caja OPEN por usuario a la vez (garantía de BD, no sólo de código).
    uniqueIndex('cash_sessions_one_open_per_user')
      .on(t.userId)
      .where(sql`${t.status} = 'OPEN'`),
    index('cash_sessions_user_idx').on(t.userId),
    index('cash_sessions_status_idx').on(t.status)
  ]
)

export const sales = sqliteTable(
  'sales',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cashSessionId: integer('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    total: integer('total').notNull(),
    // CREDIT = venta a crédito ("fiado"): parte o nada se paga ahora, el resto abre una cuenta.
    paymentMethod: text('payment_method', {
      enum: ['CASH', 'CARD', 'TRANSFER', 'CREDIT']
    }).notNull(),
    amountPaid: integer('amount_paid'), // efectivo recibido (CASH) o abono inicial (CREDIT)
    change: integer('change'), // solo si CASH
    ticketNumber: integer('ticket_number').notNull(), // folio secuencial por sesión de caja
    // Quién compró — opcional en CASH/CARD/TRANSFER, obligatorio en CREDIT (ver services/ventas.ts).
    customerId: integer('customer_id').references(() => customers.id),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [
    // El folio es secuencial por sesión de caja — no puede repetirse (carrera en Fase 2).
    uniqueIndex('sales_ticket_per_session').on(t.cashSessionId, t.ticketNumber),
    index('sales_session_idx').on(t.cashSessionId),
    index('sales_customer_idx').on(t.customerId),
    index('sales_created_at_idx').on(t.createdAt),
    index('sales_payment_method_idx').on(t.paymentMethod)
  ]
)

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    saleId: integer('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(), // snapshot al momento de la venta
    price: integer('price').notNull(), // precio final cobrado (snapshot, puede venir editado por el cajero)
    // Precio de catálogo al momento de la venta, sólo si el cajero lo modificó (null = no se tocó).
    originalPrice: integer('original_price'),
    // Snapshot de products.unit — define si `quantity` es piezas enteras o kg (con decimales).
    unit: text('unit', { enum: ['PIEZA', 'KG'] })
      .notNull()
      .default('PIEZA'),
    quantity: real('quantity').notNull(),
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

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  notes: text('notes'),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull().default(now)
})

export const creditAccounts = sqliteTable(
  'credit_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Venta que originó la cuenta (null si es una deuda registrada a mano en el futuro).
    saleId: integer('sale_id').references(() => sales.id),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    total: integer('total').notNull(), // monto adeudado (después del abono inicial de la venta)
    paid: integer('paid').notNull().default(0), // suma de abonos posteriores
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

export const creditPayments = sqliteTable(
  'credit_payments',
  {
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
    amount: integer('amount').notNull(),
    paymentMethod: text('payment_method', { enum: ['CASH', 'CARD', 'TRANSFER'] }).notNull(),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [
    index('credit_payments_account_idx').on(t.creditAccountId),
    index('credit_payments_session_idx').on(t.cashSessionId)
  ]
)

/** Retiros / ingresos de efectivo durante el turno (gastos, cambio, depósitos). */
export const cashMovements = sqliteTable(
  'cash_movements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cashSessionId: integer('cash_session_id')
      .notNull()
      .references(() => cashSessions.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ['IN', 'OUT'] }).notNull(),
    amount: integer('amount').notNull(), // centavos, siempre positivo
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => [index('cash_movements_session_idx').on(t.cashSessionId)]
)

/** Historial de inventario: cada entrada, ajuste (conteo) y venta de un producto con inventario. */
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ['ENTRY', 'ADJUST', 'SALE'] }).notNull(),
    // Cambio en la existencia (+ entra, − sale), en piezas o kg.
    quantity: real('quantity').notNull(),
    stockAfter: real('stock_after').notNull(),
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
export const productOptions = sqliteTable(
  'product_options',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
export const productComponents = sqliteTable(
  'product_components',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    componentId: integer('component_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull()
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
export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    customerName: text('customer_name').notNull(),
    phone: text('phone'),
    pickupAt: integer('pickup_at').notNull(), // Unix (s): cuándo pasan por él
    notes: text('notes'),
    // Renglones del carrito (CartLineInput[] en JSON): se validan otra vez al entregarlo.
    items: text('items').notNull(),
    total: integer('total').notNull(), // centavos, con los precios del día en que se encargó
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

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const license = sqliteTable(
  'license',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fingerprint: text('fingerprint').notNull(), // SHA-256 del hardware
    key: text('key').notNull(),
    activatedAt: integer('activated_at').notNull().default(now),
    status: text('status', { enum: ['ACTIVE', 'REVOKED'] })
      .notNull()
      .default('ACTIVE')
  },
  (t) => [
    // Como mucho una licencia ACTIVE a la vez.
    uniqueIndex('license_one_active')
      .on(sql`(1)`)
      .where(sql`${t.status} = 'ACTIVE'`)
  ]
)

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
export type CashMovementRow = typeof cashMovements.$inferSelect
export type ConfigRow = typeof config.$inferSelect
export type LicenseRow = typeof license.$inferSelect
