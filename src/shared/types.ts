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
  /** Código de barras (EAN/UPC o interno); null si el producto no tiene. */
  barcode: string | null
  /** 1 = precio libre ("Varios", servicios): el cajero escribe el importe al cobrar. */
  openPrice: number
  /** 1 = se lleva inventario de este producto. */
  trackStock: number
  /** Existencia actual (piezas o kg). Sólo tiene sentido si `trackStock`; puede ser negativa. */
  stock: number
  /** Existencia mínima: al llegar a ella el producto sale "por agotarse". null = sin aviso. */
  minStock: number | null
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
  /** Unix (s) en que se agregó a una venta ya cobrada; null = parte de la venta original. */
  addedAt: number | null
  /** Indicación para quien despacha ("sin chile", "bien dorado"); null = ninguna. */
  note: string | null
}

/** Opción a elegir al vender un producto ("Tipo de pollo": "Adobado"). */
export interface ProductOption {
  id: number
  /** Grupo de "elige uno" al que pertenece ("Tipo de pollo", "Salsa"). */
  groupName: string
  name: string
  /** Lo que se suma al precio del producto (0 = mismo precio). */
  price: number
  sortOrder: number
}

/** Un producto que va dentro de un paquete o presentación (para descontar inventario). */
export interface ProductComponent {
  componentId: number
  name: string
  unit: ProductUnit
  /** Cuánto lleva por cada uno vendido (0.5 = medio pollo). */
  quantity: number
}

/** Producto con el nombre de su categoría resuelto (respuesta de `GET /api/productos`). */
export interface ProductWithCategory extends Product {
  categoryName: string | null
  /** Opciones activas a elegir al venderlo, en orden; vacío = se vende tal cual. */
  options: ProductOption[]
  /** Qué lleva (paquetes y presentaciones); vacío = no es paquete. */
  components: ProductComponent[]
}

/** Un renglón a importar (de Excel o de un catálogo base). Precio en pesos. */
export interface ImportProductItem {
  name: string
  price: number
  unit: ProductUnit
  /** Nombre de la categoría; si no existe se crea. null = sin categoría. */
  category: string | null
  barcode: string | null
}

export interface ImportProductsRequest {
  items: ImportProductItem[]
  /** true = sólo revisa (no guarda nada): para la vista previa. */
  dryRun?: boolean
}

export interface ImportProductsResult {
  created: number
  /** Renglones que no se importan, con el motivo (`index` = posición en `items`). */
  skipped: { index: number; name: string; reason: string }[]
  /** Categorías nuevas que se crearon (o se crearían, en dryRun). */
  newCategories: string[]
}

/** Respuesta de leer un Excel/CSV de productos. */
export interface ParsedImportSheet {
  rows: ParsedImportRow[]
  /** Renglones con nombre pero sin precio: no se importan (catálogo usado como lista). */
  withoutPrice: number
}

/** Renglón leído de un Excel/CSV; `error` si no se pudo interpretar. */
export interface ParsedImportRow {
  /** Número de renglón en la hoja (para que el admin lo encuentre). */
  row: number
  item: ImportProductItem | null
  error?: string
}

/** Catálogo base (lista de productos sugeridos para dar de alta). */
export interface CatalogInfo {
  id: string
  name: string
  description: string
  source: string
  count: number
}

export interface CatalogItem {
  barcode: string | null
  name: string
  brand: string | null
  size: string | null
  category: string
  unit: ProductUnit
}

/** Resultado de buscar un código de barras que no está dado de alta. */
export interface BarcodeLookup {
  /** 'catalogo' = catálogo base (sin internet) · 'internet' = Open Food Facts en línea. */
  source: 'catalogo' | 'internet'
  item: CatalogItem
}

/** Resultado de aplicar una plantilla de negocio (`POST /api/productos/plantillas/:id`). */
export interface TemplateResult {
  /** Productos que se dieron de alta. */
  created: string[]
  /** Productos que ya existían con ese nombre: no se tocaron. */
  existing: string[]
  /** Los que no se pudieron dar de alta y por qué. */
  failed: { name: string; reason: string }[]
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
  /** Omitido = no se toca; null o '' = se quita el código. */
  barcode?: string | null
  /** Precio libre: el cajero escribe el importe al cobrar. Omitido = no se toca. */
  openPrice?: boolean
  /** Llevar inventario. Omitido = no se toca. */
  trackStock?: boolean
  /** Existencia mínima para el aviso "por agotarse"; null = sin aviso. Omitido = no se toca. */
  minStock?: number | null
  /** Existencia con la que arranca el inventario: sólo se usa al activarlo (alta o edición). */
  initialStock?: number
  /** Opciones a elegir al venderlo. Omitido = no se tocan; [] = se quitan todas. */
  options?: ProductOptionInput[]
  /** Contenido del paquete. Omitido = no se toca; [] = deja de ser paquete. */
  components?: { componentId: number; quantity: number }[]
  active?: boolean
}

/** Opción en el formulario de producto: con `id` se edita la existente; sin `id` es nueva. */
export interface ProductOptionInput {
  id?: number
  groupName: string
  name: string
  price: number
}

/** Línea del carrito que el cliente envía. */
export interface CartLineInput {
  productId: number
  /** Piezas enteras si el producto es PIEZA; kg (con decimales) si es KG. */
  quantity: number
  /** Precio editado por el cajero para esta línea (ej. descuento a un cliente frecuente). Si se
   *  omite, o coincide con el precio de catálogo, se usa el precio de catálogo tal cual. */
  price?: number
  /** Precio libre: qué se cobró ("Engargolado"), va en el nombre del renglón. Cualquier otro
   *  producto: indicación para quien despacha ("sin chile"). Va al ticket. */
  note?: string
  /** Opciones elegidas: una por cada grupo del producto ("Adobado"). */
  optionIds?: number[]
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
  /** Se está entregando este encargo: queda entregado y su anticipo se descuenta del total. */
  orderId?: number
  /** Versión del encargo/cuenta que se cargó al carrito (obligatoria en cuentas abiertas). */
  orderVersion?: number
}

/* ---- Encargos ---- */

export type OrderStatus = 'PENDING' | 'DELIVERED' | 'CANCELLED'
/** ENCARGO = pasan por él a cierta hora. CUENTA = cuenta abierta (mesa) que se cobra al final. */
export type OrderType = 'ENCARGO' | 'CUENTA'

/**
 * Renglón de un encargo: lo que se mandó del carrito (`price` sólo si el cajero lo rebajó) más
 * cómo quedó ese día (nombre con opciones y precio por unidad).
 */
export interface OrderItem extends CartLineInput {
  name: string
  unit: ProductUnit
  unitPrice: number
  subtotal: number
}

export interface Order {
  id: number
  type: OrderType
  /** Encargo: a nombre de quién. Cuenta abierta: la mesa o el cliente ("Mesa 3"). */
  customerName: string
  phone: string | null
  /** Unix (s): encargo = cuándo pasan por él; cuenta abierta = cuándo se abrió. */
  pickupAt: number
  notes: string | null
  items: OrderItem[]
  /** Total con los precios del día en que se encargó. */
  total: number
  /** Sube con cada cambio: cobrar o corregir con una versión vieja da 409. */
  version: number
  /** Anticipo que ya dejaron (0 = nada). */
  deposit: number
  depositSaleId: number | null
  status: OrderStatus
  /** Venta con la que se entregó. */
  saleId: number | null
  userId: number
  userName: string
  createdAt: number
  closedAt: number | null
}

/** Cuerpo de `POST /api/encargos`. */
export interface CreateOrderInput {
  customerName: string
  phone?: string
  pickupAt: number
  notes?: string
  items: CartLineInput[]
  /** Anticipo (0..total). Si es mayor a 0 se cobra en ese momento como una venta aparte. */
  deposit?: number
  depositMethod?: SettledMethod
  /** Efectivo recibido por el anticipo (CASH). */
  amountPaid?: number
  clientRequestId?: string
}

export interface CreateOrderResponse {
  order: Order
  /** Venta del anticipo (si dejaron), para el folio y el cambio. */
  depositSale: SaleWithItems | null
  print: PrintResult
}

/** Cuerpo de `POST /api/cuentas-abiertas`: abre una cuenta (mesa) con lo que ya pidieron. */
export interface CreateTabInput {
  name: string
  items: CartLineInput[]
  /** Imprimir la comanda de lo que se agrega (para la cocina, sin precios). */
  printComanda?: boolean
}

/** Cuerpo de `POST /api/cuentas-abiertas/:id/agregar`. */
export interface AddToTabInput {
  items: CartLineInput[]
  printComanda?: boolean
}

/** Respuesta al abrir una cuenta o agregarle productos. */
export interface TabResponse {
  order: Order
  /** Sólo si se pidió la comanda. */
  print?: PrintResult
}

/** Cuerpo de `POST /api/encargos/:id/cancelar`. */
export interface CancelOrderInput {
  /** Se le regresa el anticipo en efectivo (sale de la caja como retiro). */
  refund?: boolean
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

/** Un renglón del ticket (48 columnas). La impresora y la vista previa usan los mismos. */
export interface TicketLine {
  text: string
  align: 'left' | 'center'
  bold: boolean
}

/** Resultado de intentar imprimir un ticket. Nunca hace fallar la venta. */
export interface PrintResult {
  printed: boolean
  error?: string
  /** El negocio no usa impresora (desactivada en Configuración): no es un error. */
  skipped?: boolean
}

/** Resultado de abrir el cajón de dinero (va conectado a la impresora). */
export interface DrawerResult {
  opened: boolean
  error?: string
  /** El negocio no tiene cajón configurado: no es un error. */
  skipped?: boolean
}

/** Impresora instalada en Windows en la PC del servidor (`GET /api/admin/impresoras`). */
export interface SystemPrinter {
  name: string
  driver: string
  port: string
}

export interface SystemPrintersResponse {
  /** false si el servidor no corre en Windows (no hay lista que mostrar). */
  supported: boolean
  printers: SystemPrinter[]
  error?: string
}

/** Un respaldo en la carpeta de respaldos. */
export interface BackupFileInfo {
  name: string
  sizeBytes: number
  /** epoch en segundos */
  createdAt: number
}

/** `GET /api/admin/respaldos` */
export interface BackupStatus {
  /** Carpeta efectiva (la configurada o la de datos por defecto). */
  dir: string
  isDefaultDir: boolean
  engine: 'sqlite' | 'pg'
  /** Si el motor no admite respaldo desde la app (PGlite de pruebas). */
  unsupported?: string
  backups: BackupFileInfo[]
  /** Último intento (incluye fallidos) desde que arrancó el servidor. */
  lastAttempt: { at: number; ok: boolean; error?: string } | null
}

/** `POST /api/admin/respaldos` */
export interface BackupRunResponse {
  ok: boolean
  error?: string
  file?: BackupFileInfo
  skipped?: string
}

/** `GET /api/admin/carpetas?path=` — navegador de carpetas del servidor. */
export interface FolderListing {
  /** null = lista de unidades/raíces. */
  path: string | null
  parent: string | null
  dirs: { name: string; path: string }[]
}

/** Respuesta de `POST /api/ventas` — la venta más el estado de impresión. */
export interface CreateSaleResponse extends SaleWithItems {
  print: PrintResult
  /** Si la venta fue a crédito, la cuenta por cobrar que se abrió. */
  creditAccountId?: number
  /** true si el servidor devolvió una venta ya existente (reintento deduplicado). */
  duplicate?: boolean
}

/**
 * Cuerpo de `POST /api/ventas/:id/agregar`: productos que el cliente olvidó, sumados a una
 * venta ya cobrada del turno abierto (mismo folio). Se pagan con el método de la venta.
 */
export interface AddToSaleInput {
  items: CartLineInput[]
  /** CASH: efectivo recibido por lo agregado (>= lo agregado). Otros métodos: no se manda. */
  amountPaid?: number
  clientRequestId?: string
}

export interface AddToSaleResponse extends CreateSaleResponse {
  /** Importe de lo que se agregó (lo que se cobró ahora). */
  addedTotal: number
  /** Cambio de este cobro (sólo CASH). */
  addedChange: number | null
}

/** Venta del turno abierto (`GET /api/ventas/turno`), para completar o reimprimir. */
export interface TurnSale extends SaleListItem {
  /** El cobrador sólo puede reimprimir la última venta de su caja; el admin, cualquiera. */
  canReprint: boolean
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
  /** Suma en pesos de TODAS las ventas que cumplen los filtros (no sólo esta página). */
  sumTotal: number
  page: number
  pageSize: number
}

/** Fila del historial de cortes de caja. */
export interface CashSessionListItem extends CashSession {
  userName: string
  /** Totales de ingresos / retiros de efectivo del turno. */
  cashIn: number
  cashOut: number
  movementCount: number
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
  /** Piezas (PIEZA) o kilos (KG): define cómo mostrar `quantity`. */
  unit: ProductUnit
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
  /** Minutos respecto de UTC para "hoy" y los tramos de reportes. Vacío = huso del servidor. */
  business_utc_offset: string
  /** Descuento máximo (%) que el cobrador puede aplicar al editar un precio. '100' = sin límite. */
  max_line_discount_pct: string
  /** '1' usa impresora, '0' no. Vacío (instalaciones previas) = según printer_interface. */
  printer_enabled: string
  printer_interface: string
  /** '1' = hay cajón de dinero en el puerto RJ11 de la impresora: se abre al recibir efectivo. */
  cash_drawer: string
  backup_dir: string
}

export type ConfigInput = Partial<Omit<ConfigResponse, 'logo_path'>>

/** `GET /api/marca` (pública): lo que se muestra del negocio en la barra y el login. */
export interface BrandingResponse {
  businessName: string
  /** Relativo a /uploads/ ('' = sin logo). */
  logoPath: string
}

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
  /** Productos con inventario en su mínimo o por debajo (incluye agotados). */
  lowStockCount: number
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
  /** Enganches en efectivo de las ventas fiadas del turno. */
  creditDownCash: number
  /** Ingresos manuales de efectivo a la caja durante el turno. */
  cashIn: number
  /** Retiros manuales de efectivo de la caja durante el turno (gastos, depósitos). */
  cashOut: number
  /**
   * Efectivo esperado en caja:
   * apertura + ventas en efectivo + abonos iniciales de ventas fiadas + abonos en
   * efectivo + ingresos manuales − retiros manuales.
   */
  expectedCash: number
}

export type CashMovementType = 'IN' | 'OUT'

export interface CashMovement {
  id: number
  cashSessionId: number
  userId: number
  type: CashMovementType
  /** Monto (siempre positivo). */
  amount: number
  reason: string
  createdAt: number
}

/** Movimiento con el nombre de quien lo registró (detalle de cortes en el admin). */
export interface CashMovementWithUser extends CashMovement {
  userName: string
}

/** Cuerpo de `POST /api/caja/movimiento`. */
export interface CashMovementInput {
  type: CashMovementType
  amount: number
  reason: string
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
  /** Commit con el que se compiló el servidor ("desarrollo" si corre sin compilar). */
  commit: string
  /** Fecha de compilación (ISO), o null sin compilar. */
  builtAt: string | null
}

/** Envoltura de error homogénea para todos los endpoints. */
export interface ApiError {
  error: string
  details?: unknown
}

/* ---- Inventario ---- */

export type StockStatus = 'OK' | 'LOW' | 'OUT'

export interface InventoryItem {
  id: number
  name: string
  unit: ProductUnit
  barcode: string | null
  categoryName: string | null
  stock: number
  minStock: number | null
  /** OUT = sin existencia (0 o menos); LOW = en el mínimo o debajo; OK = el resto. */
  status: StockStatus
}

export type StockMovementType = 'ENTRY' | 'ADJUST' | 'SALE'

export interface StockMovement {
  id: number
  type: StockMovementType
  /** Cambio en la existencia (+ entra, − sale). */
  quantity: number
  stockAfter: number
  reason: string | null
  saleId: number | null
  /** Folio de la venta (si `type` = SALE). */
  ticketNumber: number | null
  userName: string
  createdAt: number
}

/** Cuerpo de `POST /api/inventario/:id/entrada` (llegó mercancía). */
export interface StockEntryInput {
  quantity: number
  reason?: string
}

/** Cuerpo de `POST /api/inventario/:id/ajuste` (conteo físico: lo que hay de verdad). */
export interface StockAdjustInput {
  counted: number
  reason?: string
}

/** Cuerpo de `POST /api/inventario/activar`: empezar a llevar inventario de varios productos. */
export interface StockEnableInput {
  productIds: number[]
}
