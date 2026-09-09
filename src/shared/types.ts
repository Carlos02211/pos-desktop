/**
 * Tipos compartidos entre el Main Process (Fastify + Drizzle) y el Renderer (React).
 * Todo lo que cruce la frontera HTTP vive aquí para mantener un solo contrato.
 */

export type Role = 'ADMIN' | 'COBRADOR'
/** Métodos con los que se cobra dinero de verdad. */
export type SettledMethod = 'CASH' | 'CARD' | 'TRANSFER'
/** Método de una venta: los anteriores más `CREDIT` (fiado). */
export type PaymentMethod = SettledMethod | 'CREDIT'
export type CashSessionStatus = 'OPEN' | 'CLOSED'
export type CreditAccountStatus = 'OPEN' | 'PAID'
export type LicenseStatus = 'ACTIVE' | 'REVOKED'
/** PIEZA = cantidad entera. KG = se vende por peso; la cantidad admite decimales (kg). */
export type ProductUnit = 'PIEZA' | 'KG'

export interface AuthUser {
  id: number
  username: string
  role: Role
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface Category {
  id: number
  name: string
  active: number
}

export interface Product {
  id: number
  name: string
  price: number
  unit: ProductUnit
  categoryId: number | null
  imagePath: string | null
  active: number
  createdAt: number
  updatedAt: number
}

export interface CashSession {
  id: number
  userId: number
  openedAt: number
  closedAt: number | null
  openingAmount: number
  closingAmount: number | null
  expectedAmount: number | null
  difference: number | null
  status: CashSessionStatus
}

export interface Sale {
  id: number
  cashSessionId: number
  userId: number
  total: number
  paymentMethod: PaymentMethod
  amountPaid: number | null
  change: number | null
  ticketNumber: number
  /** Cliente que compró (opcional salvo en CREDIT, donde es obligatorio). */
  customerId: number | null
  createdAt: number
}

export interface SaleItem {
  id: number
  saleId: number
  productId: number
  name: string
  price: number
  /** Precio de catálogo al momento de la venta, sólo si el cajero lo editó (null = no se tocó). */
  originalPrice: number | null
  /** Snapshot de `products.unit` — define si `quantity` son piezas enteras o kg (decimal). */
  unit: ProductUnit
  quantity: number
  subtotal: number
}

/** Producto con el nombre de su categoría resuelto (respuesta de `GET /api/productos`). */
export interface ProductWithCategory extends Product {
  categoryName: string | null
}

/** Categoría con el número de productos asociados (para la tabla de administración). */
export interface CategoryWithCount extends Category {
  productCount: number
}

/** Cuerpo de alta/edición de categoría (`POST`/`PUT /api/categorias`). */
export interface CategoryInput {
  name: string
  active?: boolean
}

/** Cuerpo de alta/edición de producto (`POST`/`PUT /api/productos`). */
export interface ProductInput {
  name: string
  price: number
  /** Default 'PIEZA' si se omite. */
  unit?: ProductUnit
  categoryId: number | null
  active?: boolean
}

/** Línea del carrito que el cliente envía. */
export interface CartLineInput {
  productId: number
  /** Piezas enteras si el producto es PIEZA; kg (con decimales) si es KG. */
  quantity: number
  /** Precio editado por el cajero para esta línea (ej. descuento a un cliente frecuente). Si se
   *  omite, o coincide con el precio de catálogo, se usa el precio de catálogo tal cual. */
  price?: number
}

/** Cuerpo de `POST /api/ventas`. */
export interface CreateSaleInput {
  items: CartLineInput[]
  paymentMethod: PaymentMethod
  /** CASH: efectivo recibido (>= total). CREDIT: abono inicial en efectivo (0..total). */
  amountPaid?: number
  /** A quién se le vendió. Opcional en CASH/CARD/TRANSFER; requerido en CREDIT (a quién se le fía). */
  customerId?: number
  /** Token único del intento de cobro — el servidor deduplica reintentos (doble submit / timeout). */
  clientRequestId?: string
}

/** Cuerpo de `POST /api/caja/apertura`. */
export interface OpenCashSessionInput {
  openingAmount: number
}

/** Cuerpo de `POST /api/caja/cierre`. */
export interface CloseCashSessionInput {
  /** Efectivo final contado por el cobrador. */
  closingAmount: number
}

export interface SaleWithItems extends Sale {
  items: SaleItem[]
  userName: string
  customerName: string | null
}

/** Resultado de intentar imprimir un ticket. Nunca hace fallar la venta. */
export interface PrintResult {
  printed: boolean
  error?: string
}

/** Respuesta de `POST /api/ventas` — la venta más el estado de impresión. */
export interface CreateSaleResponse extends SaleWithItems {
  print: PrintResult
  /** Si la venta fue a crédito, la cuenta por cobrar que se abrió. */
  creditAccountId?: number
  /** true si el servidor devolvió una venta ya existente (reintento deduplicado). */
  duplicate?: boolean
}

/* ---- Módulo de cuentas por cobrar ("fiado") ---- */

export interface Customer {
  id: number
  name: string
  phone: string | null
  notes: string | null
  active: number
  createdAt: number
}

/** Cliente con el saldo total que debe (suma de cuentas abiertas). */
export interface CustomerWithBalance extends Customer {
  openAccounts: number
  balance: number
}

export interface CustomerInput {
  name: string
  phone?: string
  notes?: string
  active?: boolean
}

export interface CreditPayment {
  id: number
  creditAccountId: number
  cashSessionId: number
  userId: number
  userName: string
  amount: number
  paymentMethod: SettledMethod
  createdAt: number
}

/** Fila del listado de cuentas por cobrar. */
export interface CreditAccountListItem {
  id: number
  customerId: number
  customerName: string
  saleId: number | null
  ticketNumber: number | null
  total: number
  paid: number
  balance: number
  status: CreditAccountStatus
  createdAt: number
  closedAt: number | null
}

/** Detalle de una cuenta: cabecera + venta origen + historial de abonos. */
export interface CreditAccountDetail extends CreditAccountListItem {
  userName: string
  sale: SaleWithItems | null
  payments: CreditPayment[]
}

export interface CreditQuery {
  status?: CreditAccountStatus | 'all'
  customerId?: number
  from?: number
  to?: number
}

/** Cuerpo de `POST /api/cuentas/:id/abono`. */
export interface AbonoInput {
  amount: number
  paymentMethod: SettledMethod
}

/* ---- Sprint 5: usuarios, historial de ventas y cortes ---- */

/** Usuario en la tabla de administración (sin el hash de contraseña). */
export interface UserListItem {
  id: number
  username: string
  role: Role
  active: number
  createdAt: number
}

export interface CreateUserInput {
  username: string
  password: string
  role: Role
}

export interface UpdateUserInput {
  username?: string
  role?: Role
  active?: boolean
  /** Sólo si se quiere cambiar la contraseña. */
  password?: string
}

/** Fila del historial de ventas (sin el detalle de líneas). */
export interface SaleListItem {
  id: number
  ticketNumber: number
  cashSessionId: number
  userId: number
  userName: string
  total: number
  paymentMethod: PaymentMethod
  amountPaid: number | null
  change: number | null
  customerName: string | null
  itemCount: number
  createdAt: number
}

export interface SalesQuery {
  page?: number
  pageSize?: number
  from?: number
  to?: number
  userId?: number
  paymentMethod?: PaymentMethod
}

export interface SalesPage {
  rows: SaleListItem[]
  total: number
  page: number
  pageSize: number
}

/** Fila del historial de cortes de caja. */
export interface CashSessionListItem extends CashSession {
  userName: string
}

export interface CashHistoryQuery {
  from?: number
  to?: number
  userId?: number
}

/* ---- Sprint 6: reportes ---- */

export type ReportType = 'diario' | 'semanal' | 'mensual'

export interface PaymentBreakdown {
  CASH: number
  CARD: number
  TRANSFER: number
}

export interface TopProduct {
  productId: number
  name: string
  quantity: number
  revenue: number
}

/** Un tramo del reporte: una hora (diario) o un día (semanal/mensual). */
export interface ReportBucket {
  label: string
  total: number
  count: number
}

export interface SalesReport {
  type: ReportType
  from: number
  to: number
  totalSales: number
  totalTransactions: number
  byPaymentMethod: PaymentBreakdown
  /** Total vendido a crédito (fiado) en el periodo. */
  creditExtended: number
  topProducts: TopProduct[]
  buckets: ReportBucket[]
}

/* ---- Sprint 7: configuración + dashboard ---- */

export interface ConfigResponse {
  business_name: string
  business_address: string
  business_phone: string
  logo_path: string
  ticket_footer: string
  currency_symbol: string
  printer_interface: string
  backup_dir: string
}

export type ConfigInput = Partial<Omit<ConfigResponse, 'logo_path'>>

export interface OpenSessionInfo {
  cashSessionId: number
  userId: number
  userName: string
  openedAt: number
  openingAmount: number
}

export interface DashboardData {
  date: number
  totalSales: number
  totalTransactions: number
  byPaymentMethod: PaymentBreakdown
  /** Total adeudado (saldo de todas las cuentas por cobrar abiertas). */
  cuentasPorCobrar: number
  openSessions: OpenSessionInfo[]
  recentSales: SaleListItem[]
}

/** Resumen del turno actual (para la pantalla de cierre de caja). */
export interface CashSessionSummary {
  session: CashSession
  salesCount: number
  totalAll: number
  totalCash: number
  totalCard: number
  totalTransfer: number
  /** Crédito otorgado en el turno (ventas fiadas, lo que quedó a deber). */
  totalCredit: number
  /** Abonos a cuentas anteriores recibidos en el turno (en efectivo). */
  abonosCash: number
  /**
   * Efectivo esperado en caja:
   * apertura + ventas en efectivo + abonos iniciales de ventas fiadas + abonos en efectivo.
   */
  expectedCash: number
}

export interface BusinessConfig {
  business_name: string
  business_address?: string
  business_phone?: string
  logo_path?: string
  ticket_footer?: string
  currency_symbol: string
}

/** Estado de la licencia (Sprint 1). `/api/licencia/estado`. */
export interface LicenseStatusResponse {
  active: boolean
  /** SHA-256 del hardware de este equipo. Se muestra en la pantalla de activación. */
  fingerprint: string
  activatedAt: number | null
}

/** Respuesta del endpoint de diagnóstico /api/ping (Sprint 0). */
export interface PingResponse {
  ok: true
  service: 'pos-spartan-tech'
  /** 1 = Electron + SQLite · 2 = servidor en red + PostgreSQL. */
  phase: 1 | 2
  now: number
  db: 'connected' | 'error'
  /** Motor de base de datos activo. */
  engine: 'sqlite' | 'postgres'
  version: string
}

/** Envoltura de error homogénea para todos los endpoints. */
export interface ApiError {
  error: string
  details?: unknown
}
