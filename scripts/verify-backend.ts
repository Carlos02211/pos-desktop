/**
 * Verificación de backend sin GUI (Sprints 0–8: QA).
 *
 * Reproduce lo que hace el Main Process al arrancar, pero fuera de Electron:
 *   1. Store cifrado + SQLite en un directorio temporal, con migraciones y seed.
 *   2. Levanta Fastify + Socket.io en :3001.
 *   3. Sprint 0 — GET /api/ping (Renderer -> Fastify -> SQLite) + validación Zod.
 *   4. Sprint 1 — licencia por hardware + auth (login, JWT en /api/auth/me, roles).
 *   5. Sprint 2 — catálogo, apertura de caja y registro de ventas (folio, cambio, snapshot).
 *   6. Sprint 3 — resumen de turno, cierre de caja (esperado/diferencia) + respaldo, reimpresión.
 *   7. Sprint 4 — CRUD de categorías y productos + subida de imagen (roles, soft delete).
 *   8. Sprint 5 — usuarios (bcrypt, no self-deactivate), historial de ventas y cortes de caja.
 *   9. Sprint 6 — reportes (diario/semanal/mensual) + exportación a Excel y PDF.
 *  10. Sprint 7 — configuración del negocio (logo) + dashboard del día.
 *  11. Sprint 8 — QA: la licencia falla si se copia a otro equipo (fingerprint distinto).
 *
 * Uso:  pnpm verify:backend
 */
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { createServer, type AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { count, eq } from 'drizzle-orm'
import { closeDb, initDb } from '../src/main/db'
import { config, users } from '../src/main/db/schema'
import { runSeed } from '../src/main/db/seed'
import { formatMoney } from '../src/shared/money-format'
import { getStore, initStore } from '../src/main/lib/store'
import { startServer } from '../src/main/server'
import { getHardwareFingerprint, publicKeyOf, signLicense } from '../src/main/services/license'
import type {
  AddToSaleResponse,
  CreateOrderResponse,
  Order,
  TemplateResult,
  InventoryItem,
  StockMovement,
  TurnSale,
  BackupRunResponse,
  BackupStatus,
  BrandingResponse,
  FolderListing,
  SystemPrintersResponse,
  CashMovement,
  CashMovementWithUser,
  CashSession,
  CashSessionListItem,
  CashSessionSummary,
  Category,
  CategoryWithCount,
  ConfigResponse,
  CreateSaleResponse,
  CreditAccountDetail,
  CreditAccountListItem,
  CustomerWithBalance,
  DrawerResult,
  LicenseStatusResponse,
  LoginResponse,
  PingResponse,
  ProductWithCategory,
  SalesPage,
  SalesReport,
  SaleWithItems,
  UserListItem,
  BarcodeLookup,
  CatalogInfo,
  CatalogItem,
  ImportProductsResult,
  ParsedImportSheet
} from '../src/shared/types'

// `verify:backend`     → SQLite en un directorio temporal.
// `verify:backend:pg`  → PostgreSQL embebido (PGlite) vía DATABASE_URL=pglite://<dir>.
const PG = !!process.env.DATABASE_URL
const PGLITE = !!process.env.DATABASE_URL?.startsWith('pglite://')

// Par Ed25519 efímero: el servidor (corriendo desde el código fuente) verifica con esta
// pública en lugar de la de producción, y el test firma con la privada.
const { privateKey: testLicenseKey } = crypto.generateKeyPairSync('ed25519')
process.env.POS_LICENSE_PUBLIC_KEY = publicKeyOf(testLicenseKey)
const MIGRATIONS = join(process.cwd(), 'resources', PG ? 'migrations-pg' : 'migrations')
// VERIFY_PORT permite correrlo con `pnpm dev` abierto (que ocupa el 3001).
const PORT = Number(process.env.VERIFY_PORT) || 3001

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`)
  console.log(`✓ ${msg}`)
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pos-verify-'))
  const dbPath = join(dir, 'pos.db')
  const backupDir = join(dir, 'backups')
  let server: Awaited<ReturnType<typeof startServer>> | null = null

  try {
    // Paridad de esquemas SQLite ↔ PostgreSQL (falla el proceso si divergen).
    execFileSync('npx', ['tsx', join(process.cwd(), 'scripts', 'check-schema-parity.ts')], {
      stdio: 'inherit'
    })

    await initStore(dir, 'file')
    const db = await initDb(dbPath, MIGRATIONS)
    await runSeed(db)

    const engineLabel = !PG
      ? 'SQLite'
      : process.env.DATABASE_URL!.startsWith('pglite://')
        ? 'PostgreSQL (PGlite embebido)'
        : 'PostgreSQL (real)'
    assert(true, `motor de base de datos: ${engineLabel}`)

    // ---- Sprint 0: seed ----
    const [{ n: userCount }] = await db.select({ n: count() }).from(users)
    assert(Number(userCount) === 2, `seed: 2 usuarios (admin + cajero) — encontrados: ${userCount}`)
    const [admin] = await db.select().from(users).where(eq(users.username, 'admin')).limit(1)
    assert(admin?.role === 'ADMIN', 'seed: "admin" con rol ADMIN')
    assert(admin!.password.startsWith('$2'), 'seed: contraseña como hash bcrypt')

    await runSeed(db)
    const [{ n: userCount2 }] = await db.select({ n: count() }).from(users)
    assert(Number(userCount2) === 2, 'seed idempotente: no duplica en la 2ª ejecución')

    server = await startServer({
      port: PORT,
      version: '0.1.0',
      isDev: false,
      dbPath,
      backupDir,
      uploadsDir: join(dir, 'uploads')
    })
    const base = server.url
    assert(true, `Fastify escuchando en ${base}`)

    // ---- Sprint 0: ping ----
    const ping = (await (await fetch(`${base}/api/ping?echo=hola`)).json()) as PingResponse & {
      echo?: string
    }
    assert(ping.ok && ping.db === 'connected', 'ping: ok + SQLite conectado')
    assert(ping.echo === 'hola', 'ping: valida y refleja el query (Zod)')
    const badPing = await fetch(`${base}/api/ping?echo=${'x'.repeat(200)}`)
    assert(badPing.status === 400, `ping: query inválido -> 400 (status: ${badPing.status})`)

    // ---- Sprint 1: licencia ----
    const status1 = (await (
      await fetch(`${base}/api/licencia/estado`)
    ).json()) as LicenseStatusResponse
    assert(status1.active === false, 'licencia: arranca inactiva')
    assert(/^[a-f0-9]{64}$/.test(status1.fingerprint), 'licencia: fingerprint SHA-256 presente')

    const wrong = await fetch(`${base}/api/licencia/activar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE' })
    })
    assert(wrong.status === 403, `licencia: clave inválida -> 403 (status: ${wrong.status})`)

    const fingerprint = await getHardwareFingerprint()
    assert(fingerprint === status1.fingerprint, 'licencia: fingerprint estable entre llamadas')
    const validKey = signLicense(fingerprint, testLicenseKey)

    // Una letra cambiada invalida la firma.
    const flipped = validKey.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))
    const badSig = await fetch(`${base}/api/licencia/activar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: flipped })
    })
    assert(badSig.status === 403, `licencia: firma alterada -> 403 (status: ${badSig.status})`)

    // Cambiar el ÚLTIMO carácter sólo toca bits de relleno: debe rechazarse igual (una sola
    // escritura válida por firma).
    const lastChar = validKey.slice(-1)
    const paddedVariant = validKey.slice(0, -1) + (lastChar === 'A' ? 'C' : 'A')
    const badPad = await fetch(`${base}/api/licencia/activar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: paddedVariant })
    })
    assert(
      badPad.status === 403,
      `licencia: último carácter alterado -> 403 (status: ${badPad.status})`
    )

    // Firmada con OTRA clave privada (p. ej. alguien que generó su propio par) -> rechazada.
    const { privateKey: rogueKey } = crypto.generateKeyPairSync('ed25519')
    const rogue = await fetch(`${base}/api/licencia/activar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: signLicense(fingerprint, rogueKey) })
    })
    assert(
      rogue.status === 403,
      `licencia: firmada con otra clave -> 403 (status: ${rogue.status})`
    )

    const activated = await fetch(`${base}/api/licencia/activar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: validKey })
    })
    assert(activated.ok, `licencia: clave válida -> 200 (status: ${activated.status})`)
    const status2 = (await activated.json()) as LicenseStatusResponse
    assert(
      status2.active === true && typeof status2.activatedAt === 'number',
      'licencia: queda activa'
    )

    // Sprint 8 QA: copiar la licencia a OTRO equipo (fingerprint distinto) la invalida.
    const store = getStore()
    const realFp = store.get('license_fingerprint')
    store.set('license_fingerprint', 'f'.repeat(64))
    const tampered = (await (
      await fetch(`${base}/api/licencia/estado`)
    ).json()) as LicenseStatusResponse
    assert(
      tampered.active === false,
      'licencia: fingerprint que no coincide -> inactiva (otro equipo)'
    )
    store.set('license_fingerprint', realFp!)
    assert(
      ((await (await fetch(`${base}/api/licencia/estado`)).json()) as LicenseStatusResponse)
        .active === true,
      'licencia: vuelve a activarse con el fingerprint correcto'
    )

    // ---- Sprint 1: auth ----
    async function login(username: string, password: string): Promise<Response> {
      return fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
    }

    const badLogin = await login('admin', 'noeslacontraseña')
    assert(
      badLogin.status === 401,
      `login: contraseña incorrecta -> 401 (status: ${badLogin.status})`
    )

    const okLogin = await login('admin', 'admin123')
    assert(okLogin.ok, `login: admin/admin123 -> 200 (status: ${okLogin.status})`)
    const session = (await okLogin.json()) as LoginResponse
    assert(session.user.role === 'ADMIN', 'login: devuelve el rol ADMIN')
    assert(session.token.split('.').length === 3, 'login: devuelve un JWT')

    const cajeroLogin = (await (await login('cajero', 'cajero123')).json()) as LoginResponse
    assert(cajeroLogin.user.role === 'COBRADOR', 'login: cajero devuelve rol COBRADOR')

    const meNoToken = await fetch(`${base}/api/auth/me`)
    assert(meNoToken.status === 401, `/api/auth/me sin token -> 401 (status: ${meNoToken.status})`)

    const meBadToken = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: 'Bearer no.es.valido' }
    })
    assert(
      meBadToken.status === 401,
      `/api/auth/me token inválido -> 401 (status: ${meBadToken.status})`
    )

    const me = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: `Bearer ${session.token}` }
    })
    assert(me.ok, `/api/auth/me con token -> 200 (status: ${me.status})`)
    const meBody = (await me.json()) as { user: { username: string } }
    assert(meBody.user.username === 'admin', '/api/auth/me: identifica al usuario del token')

    // ---- Sprint 2: catálogo + caja + ventas (como cobrador) ----
    const cajeroToken = (await (await login('cajero', 'cajero123')).json()) as LoginResponse
    const call =
      (token: string) =>
      (path: string, method = 'GET', body?: unknown): Promise<Response> =>
        fetch(`${base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        })
    const asCajero = call(cajeroToken.token)
    const asAdmin = call(session.token)

    const catalogo = (await (await asCajero('/api/productos')).json()) as ProductWithCategory[]
    // La migración deja listo "Varios" (precio libre); aparte, el producto de prueba del seed.
    const varios = catalogo.find((p) => p.openPrice === 1)
    assert(
      varios?.name === 'Varios' && varios.price === 0,
      `catálogo: "Varios" de precio libre creado por la migración (${JSON.stringify(varios)})`
    )
    const prods = catalogo.filter((p) => p.openPrice === 0)
    assert(prods.length === 1, `catálogo: 1 producto activo (encontrados: ${prods.length})`)
    assert(
      prods[0].categoryName === 'General' && prods[0].price === 25,
      'catálogo: producto trae categoría resuelta y precio'
    )
    const producto = prods[0]

    const cats = (await (await asCajero('/api/categorias')).json()) as Category[]
    assert(cats.length === 1 && cats[0].name === 'General', 'catálogo: 1 categoría activa')

    assert(
      (await asCajero('/api/caja/sesion-activa')).status === 200,
      '/api/caja/sesion-activa responde 200'
    )
    const sinCaja = (await asCajero('/api/caja/sesion-activa')).json()
    assert((await sinCaja) === null, 'caja: arranca sin sesión activa')

    const ventaSinCaja = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CASH',
      amountPaid: 100
    })
    assert(
      ventaSinCaja.status === 409,
      `venta sin caja abierta -> 409 (status: ${ventaSinCaja.status})`
    )

    const apertura = await asCajero('/api/caja/apertura', 'POST', { openingAmount: 500 })
    assert(apertura.status === 201, `apertura de caja -> 201 (status: ${apertura.status})`)
    const sesion = (await apertura.json()) as CashSession
    assert(
      sesion.status === 'OPEN' && sesion.openingAmount === 500,
      'caja: sesión OPEN con monto inicial'
    )

    const apertura2 = await asCajero('/api/caja/apertura', 'POST', { openingAmount: 100 })
    assert(apertura2.status === 409, `segunda apertura -> 409 (status: ${apertura2.status})`)

    const ventaCash = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 2 }],
      paymentMethod: 'CASH',
      amountPaid: 100
    })
    assert(ventaCash.status === 201, `venta efectivo -> 201 (status: ${ventaCash.status})`)
    const sale1 = (await ventaCash.json()) as SaleWithItems
    assert(sale1.total === 50 && sale1.change === 50, 'venta: total 50 y cambio 50 calculados')
    assert(sale1.ticketNumber === 1, 'venta: folio 1 en la sesión')
    assert(
      sale1.items[0].name === 'Producto de prueba' && sale1.items[0].price === 25,
      'venta: snapshot de nombre y precio en sale_items'
    )

    const ventaCorta = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CASH',
      amountPaid: 5
    })
    assert(
      ventaCorta.status === 400,
      `venta con pago insuficiente -> 400 (status: ${ventaCorta.status})`
    )

    const ventaCard = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CARD'
    })
    const sale2 = (await ventaCard.json()) as CreateSaleResponse
    assert(sale2.ticketNumber === 2, 'venta: folio incrementa a 2')
    assert(
      sale2.change === null && sale2.amountPaid === null,
      'venta tarjeta: sin cambio ni monto pagado'
    )
    assert(
      sale2.print.printed === false && sale2.print.skipped === true && !sale2.print.error,
      'venta: negocio sin impresora -> print.skipped (sin error ni aviso) y la venta se registra'
    )

    // ---- Sprint 3: resumen, cierre de caja + respaldo, reimpresión ----
    const resumen = (await (await asCajero('/api/caja/resumen')).json()) as CashSessionSummary
    // ventas registradas: efectivo 2×25=50, tarjeta 1×25=25  → efectivo esperado 500+50
    assert(
      resumen.salesCount === 2 && resumen.totalCash === 50 && resumen.totalCard === 25,
      `resumen: 2 ventas, efectivo 50, tarjeta 25 (got ${resumen.salesCount}/${resumen.totalCash}/${resumen.totalCard})`
    )
    assert(
      resumen.expectedCash === 550,
      `resumen: efectivo esperado 550 (got ${resumen.expectedCash})`
    )

    // ---- Movimientos de efectivo (retiro / ingreso) ----
    const retiro = await asCajero('/api/caja/movimiento', 'POST', {
      type: 'OUT',
      amount: 30,
      reason: 'Compra de bolsas'
    })
    assert(retiro.status === 201, `retiro de efectivo -> 201 (status: ${retiro.status})`)
    await asCajero('/api/caja/movimiento', 'POST', {
      type: 'IN',
      amount: 5,
      reason: 'Devolución de vuelto'
    })
    const retiroExcesivo = await asCajero('/api/caja/movimiento', 'POST', {
      type: 'OUT',
      amount: 100000,
      reason: 'Prueba'
    })
    assert(
      retiroExcesivo.status === 400,
      `retiro mayor al efectivo en caja -> 400 (status: ${retiroExcesivo.status})`
    )
    const movs = (await (await asCajero('/api/caja/movimientos')).json()) as CashMovement[]
    assert(movs.length === 2, `movimientos: se listan los 2 del turno (got ${movs.length})`)
    const resumen2 = (await (await asCajero('/api/caja/resumen')).json()) as CashSessionSummary
    // 550 esperado − 30 retiro + 5 ingreso = 525
    assert(
      resumen2.cashOut === 30 && resumen2.cashIn === 5 && resumen2.expectedCash === 525,
      `resumen: retiros 30, ingresos 5, esperado 525 (got ${resumen2.cashOut}/${resumen2.cashIn}/${resumen2.expectedCash})`
    )

    const reimpr = await asAdmin(`/api/ventas/${sale1.id}/reimprimir`, 'POST')
    assert(
      reimpr.status === 409,
      `reimprimir sin impresora activada -> 409 (status: ${reimpr.status})`
    )

    const cierre = await asCajero('/api/caja/cierre', 'POST', { closingAmount: 540 })
    assert(cierre.status === 200, `cierre de caja -> 200 (status: ${cierre.status})`)
    const cierreBody = (await cierre.json()) as {
      session: CashSession
      backup: { ok: boolean; path?: string; skipped?: string }
    }
    assert(cierreBody.session.status === 'CLOSED', 'cierre: sesión queda CLOSED')
    // esperado = 500 apertura + 50 efectivo − 30 retiro + 5 ingreso = 525
    assert(cierreBody.session.expectedAmount === 525, 'cierre: efectivo esperado 525')
    assert(cierreBody.session.difference === 15, 'cierre: diferencia +15 (sobrante)')
    if (PGLITE) {
      assert(
        cierreBody.backup.ok && !!cierreBody.backup.skipped,
        'cierre: respaldo omitido con PGlite (no hay pg_dump para una base embebida)'
      )
    } else {
      assert(
        cierreBody.backup.ok && !!cierreBody.backup.path && existsSync(cierreBody.backup.path),
        `cierre: respaldo de la BD creado en disco (${PG ? 'pg_dump' : 'copia SQLite'})`
      )
    }

    const cierre2 = await asCajero('/api/caja/cierre', 'POST', { closingAmount: 100 })
    assert(cierre2.status === 409, `cierre sin caja abierta -> 409 (status: ${cierre2.status})`)

    const ventaCerrada = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CARD'
    })
    assert(
      ventaCerrada.status === 409,
      `vender tras cerrar caja -> 409 (status: ${ventaCerrada.status})`
    )

    // ---- Sprint 4: CRUD de categorías y productos + subida de imagen (ADMIN) ----
    const catNueva = await asAdmin('/api/categorias', 'POST', { name: 'Bebidas' })
    assert(catNueva.status === 201, `crear categoría -> 201 (status: ${catNueva.status})`)
    const bebidas = (await catNueva.json()) as Category
    const catDup = await asAdmin('/api/categorias', 'POST', { name: 'Bebidas' })
    assert(catDup.status === 409, `categoría duplicada -> 409 (status: ${catDup.status})`)

    const catCajero = await asCajero('/api/categorias', 'POST', { name: 'X' })
    assert(
      catCajero.status === 403,
      `cobrador no puede crear categoría -> 403 (${catCajero.status})`
    )

    await asAdmin(`/api/categorias/${bebidas.id}`, 'PUT', { name: 'Bebidas frías', active: true })
    const catsAdmin = (await (await asAdmin('/api/categorias?all=1')).json()) as CategoryWithCount[]
    assert(
      catsAdmin.some((c) => c.id === bebidas.id && c.name === 'Bebidas frías'),
      'categoría: PUT renombra'
    )
    assert(
      catsAdmin.find((c) => c.name === 'General')?.productCount === 1,
      'categoría: productCount refleja los productos'
    )

    const prodNuevo = await asAdmin('/api/productos', 'POST', {
      name: 'Refresco',
      price: 18.5,
      categoryId: bebidas.id
    })
    assert(prodNuevo.status === 201, `crear producto -> 201 (status: ${prodNuevo.status})`)
    const refresco = (await prodNuevo.json()) as { id: number }

    const prodCajero = await asCajero('/api/productos', 'POST', {
      name: 'Y',
      price: 1,
      categoryId: null
    })
    assert(
      prodCajero.status === 403,
      `cobrador no puede crear producto -> 403 (${prodCajero.status})`
    )

    await asAdmin(`/api/productos/${refresco.id}`, 'PUT', {
      name: 'Refresco 600ml',
      price: 20,
      categoryId: bebidas.id,
      active: true
    })
    const prodsAll = (await (await asAdmin('/api/productos?all=1')).json()) as ProductWithCategory[]
    const edited = prodsAll.find((p) => p.id === refresco.id)!
    assert(
      edited.name === 'Refresco 600ml' &&
        edited.price === 20 &&
        edited.categoryName === 'Bebidas frías',
      'producto: PUT actualiza nombre, precio y categoría'
    )

    // Código de barras: único, se conserva si el PUT no lo manda, '' lo quita.
    const conCodigo = await asAdmin(`/api/productos/${refresco.id}`, 'PUT', {
      name: 'Refresco 600ml',
      price: 20,
      categoryId: bebidas.id,
      barcode: ' 7501055300075 '
    })
    assert(
      ((await conCodigo.json()) as ProductWithCategory).barcode === '7501055300075',
      'código de barras: PUT lo guarda sin espacios de los extremos'
    )
    const duplicado = await asAdmin('/api/productos', 'POST', {
      name: 'Otro refresco',
      price: 10,
      categoryId: null,
      barcode: '7501055300075'
    })
    const dupMsg = ((await duplicado.json()) as { error?: string }).error ?? ''
    assert(
      duplicado.status === 409 && dupMsg.includes('Refresco 600ml'),
      `código de barras repetido -> 409 con el producto dueño (${duplicado.status}: ${dupMsg})`
    )
    const conEspacio = await asAdmin('/api/productos', 'POST', {
      name: 'Z',
      price: 1,
      categoryId: null,
      barcode: '750 105'
    })
    assert(conEspacio.status === 400, `código con espacio interno -> 400 (${conEspacio.status})`)
    const sinCampo = await asAdmin(`/api/productos/${refresco.id}`, 'PUT', {
      name: 'Refresco 600ml',
      price: 20,
      categoryId: bebidas.id
    })
    assert(
      ((await sinCampo.json()) as ProductWithCategory).barcode === '7501055300075',
      'código de barras: un PUT sin el campo lo conserva'
    )
    const cobradorVe = (await (await asCajero('/api/productos')).json()) as ProductWithCategory[]
    assert(
      cobradorVe.find((p) => p.id === refresco.id)?.barcode === '7501055300075',
      'código de barras: el cobrador lo recibe en GET /api/productos'
    )
    const quitado = await asAdmin(`/api/productos/${refresco.id}`, 'PUT', {
      name: 'Refresco 600ml',
      price: 20,
      categoryId: bebidas.id,
      barcode: ''
    })
    assert(
      ((await quitado.json()) as ProductWithCategory).barcode === null,
      "código de barras: '' lo quita (queda null)"
    )

    // Subida de imagen (multipart).
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const form = new FormData()
    form.append('file', new Blob([png], { type: 'image/png' }), 'test.png')
    const imgRes = await fetch(`${base}/api/productos/${refresco.id}/imagen`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
      body: form
    })
    assert(imgRes.status === 201, `subir imagen -> 201 (status: ${imgRes.status})`)
    const { path: imgPath } = (await imgRes.json()) as { path: string }
    assert(imgPath.startsWith('productos/') && imgPath.endsWith('.png'), 'imagen: ruta relativa')
    const served = await fetch(`${base}/uploads/${imgPath}`)
    assert(served.status === 200, `imagen servida en /uploads/ -> 200 (status: ${served.status})`)

    // Un archivo que NO es imagen aunque diga image/png -> rechazado (magic bytes).
    const fakeForm = new FormData()
    fakeForm.append(
      'file',
      new Blob([Buffer.from('<html>not an image</html>')], { type: 'image/png' }),
      'x.png'
    )
    const fakeRes = await fetch(`${base}/api/productos/${refresco.id}/imagen`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
      body: fakeForm
    })
    assert(
      fakeRes.status === 400,
      `imagen: archivo no-imagen con Content-Type falso -> 400 (status: ${fakeRes.status})`
    )

    // Soft delete de producto.
    const del = await asAdmin(`/api/productos/${refresco.id}`, 'DELETE')
    assert(del.status === 204, `desactivar producto -> 204 (status: ${del.status})`)
    const prodsCajero = (await (await asCajero('/api/productos')).json()) as ProductWithCategory[]
    assert(
      !prodsCajero.some((p) => p.id === refresco.id),
      'producto inactivo: no aparece para el cobrador'
    )
    const prodsAll2 = (await (
      await asAdmin('/api/productos?all=1')
    ).json()) as ProductWithCategory[]
    assert(
      prodsAll2.find((p) => p.id === refresco.id)?.active === 0,
      'producto inactivo: sigue en ?all=1 con active=0 (soft delete)'
    )

    const catDel = await asAdmin(`/api/categorias/${bebidas.id}`, 'DELETE')
    assert(catDel.status === 204, `desactivar categoría -> 204 (status: ${catDel.status})`)
    const catsCajero = (await (await asCajero('/api/categorias')).json()) as Category[]
    assert(
      !catsCajero.some((c) => c.id === bebidas.id),
      'categoría inactiva: no aparece para el cobrador'
    )

    // ---- Sprint 5: usuarios, historial de ventas y cortes de caja (ADMIN) ----
    const usersList = (await (await asAdmin('/api/usuarios')).json()) as UserListItem[]
    assert(usersList.length === 2, `usuarios: 2 en la lista (got ${usersList.length})`)
    assert(!('password' in usersList[0]), 'usuarios: la lista no expone el hash de contraseña')
    assert(
      (await asCajero('/api/usuarios')).status === 403,
      'usuarios: cobrador no puede listar (403)'
    )

    const nuevoU = await asAdmin('/api/usuarios', 'POST', {
      username: 'cajero2',
      password: 'secreto123',
      role: 'COBRADOR'
    })
    assert(nuevoU.status === 201, `crear usuario -> 201 (status: ${nuevoU.status})`)
    const cajero2 = (await nuevoU.json()) as UserListItem
    const dupU = await asAdmin('/api/usuarios', 'POST', {
      username: 'cajero2',
      password: 'otracosa',
      role: 'COBRADOR'
    })
    assert(dupU.status === 409, `usuario duplicado -> 409 (status: ${dupU.status})`)
    const shortPw = await asAdmin('/api/usuarios', 'POST', {
      username: 'x3y',
      password: 'corta',
      role: 'COBRADOR'
    })
    assert(shortPw.status === 400, `contraseña corta -> 400 (status: ${shortPw.status})`)

    const loginU2 = await (await login('cajero2', 'secreto123')).json()
    assert(
      (loginU2 as LoginResponse).user?.role === 'COBRADOR',
      'usuarios: el nuevo usuario puede iniciar sesión (bcrypt en el backend)'
    )

    const selfOff = await asAdmin('/api/usuarios/1', 'PUT', { active: false })
    assert(
      selfOff.status === 400,
      `admin no puede desactivarse a sí mismo -> 400 (${selfOff.status})`
    )
    const selfDel = await asAdmin('/api/usuarios/1', 'DELETE')
    assert(selfDel.status === 400, `admin no puede borrarse a sí mismo -> 400 (${selfDel.status})`)

    const delU2 = await asAdmin(`/api/usuarios/${cajero2.id}`, 'DELETE')
    assert(delU2.status === 204, `desactivar usuario -> 204 (status: ${delU2.status})`)
    const usersAfter = (await (await asAdmin('/api/usuarios')).json()) as UserListItem[]
    assert(
      usersAfter.find((u) => u.id === cajero2.id)?.active === 0,
      'usuarios: desactivado queda con active=0'
    )

    // Historial de ventas — hay 2 ventas (efectivo 50 folio1, tarjeta 25 folio2), ambas del cajero.
    const ventasPage = (await (await asAdmin('/api/ventas')).json()) as SalesPage
    assert(ventasPage.total === 2, `ventas: total 2 (got ${ventasPage.total})`)
    assert(ventasPage.sumTotal === 75, `ventas: suma de totales $75 (got ${ventasPage.sumTotal})`)
    assert(
      ventasPage.rows[0].ticketNumber === 2 && ventasPage.rows[0].itemCount === 1,
      'ventas: orden por fecha desc y itemCount calculado'
    )
    const ventasCash = (await (await asAdmin('/api/ventas?paymentMethod=CASH')).json()) as SalesPage
    assert(
      ventasCash.total === 1,
      `ventas: filtro por método CASH -> total 1 (got ${ventasCash.total})`
    )
    const ventasAdminUser = (await (await asAdmin('/api/ventas?userId=1')).json()) as SalesPage
    assert(ventasAdminUser.total === 0, 'ventas: filtro por cobrador sin ventas -> total 0')

    const detalle = (await (await asAdmin('/api/ventas/1')).json()) as SaleWithItems
    assert(
      detalle.ticketNumber === 1 && detalle.items.length === 1,
      'ventas: detalle de una venta con sus líneas'
    )
    assert(
      (await asCajero('/api/ventas')).status === 403,
      'ventas: cobrador no puede ver el historial (403)'
    )

    const cortes = (await (await asAdmin('/api/caja/historial')).json()) as CashSessionListItem[]
    assert(cortes.length === 1, `cortes: 1 sesión en el historial (got ${cortes.length})`)
    assert(
      cortes[0].userName === 'cajero' &&
        cortes[0].status === 'CLOSED' &&
        cortes[0].difference === 15,
      'cortes: nombre del cobrador, estado y diferencia'
    )
    assert(
      (await asCajero('/api/caja/historial')).status === 403,
      'cortes: cobrador no puede ver el historial (403)'
    )
    assert(
      cortes[0].cashOut === 30 && cortes[0].cashIn === 5 && cortes[0].movementCount === 2,
      `cortes: retiros 30 / ingresos 5 / 2 movimientos (got ${cortes[0].cashOut}/${cortes[0].cashIn}/${cortes[0].movementCount})`
    )
    const cortesMovs = (await (
      await asAdmin(`/api/caja/${cortes[0].id}/movimientos`)
    ).json()) as CashMovementWithUser[]
    assert(
      cortesMovs.length === 2 &&
        cortesMovs.every((m) => m.userName === 'cajero' && m.reason.length >= 2) &&
        cortesMovs.some((m) => m.type === 'OUT' && m.amount === 30),
      'cortes: detalle de movimientos con monto, motivo y quién'
    )
    assert(
      (await asCajero(`/api/caja/${cortes[0].id}/movimientos`)).status === 403,
      'cortes: el cobrador no puede ver el detalle de otro turno (403)'
    )

    // ---- Sprint 6: reportes + exportación Excel/PDF (ADMIN) ----
    const hoy = new Date().toLocaleDateString('sv-SE') // fecha local YYYY-MM-DD
    const reporte = (await (
      await asAdmin(`/api/reportes/diario?fecha=${hoy}`)
    ).json()) as SalesReport
    assert(
      reporte.buckets.length === 24,
      `reporte diario: 24 tramos horarios (got ${reporte.buckets.length})`
    )
    assert(
      reporte.totalTransactions >= 2,
      `reporte diario: cuenta las ventas del día (got ${reporte.totalTransactions})`
    )
    assert(
      reporte.topProducts.some(
        (p) => p.name === 'Producto de prueba' && p.unit === 'PIEZA' && p.quantity >= 3
      ),
      'reporte diario: top de productos con cantidades'
    )
    assert(
      reporte.byPaymentMethod.CASH === 50 && reporte.byPaymentMethod.CARD === 25,
      `reporte diario: desglose por método (efectivo ${reporte.byPaymentMethod.CASH}, tarjeta ${reporte.byPaymentMethod.CARD})`
    )
    assert(
      (await asCajero(`/api/reportes/diario?fecha=${hoy}`)).status === 403,
      'reportes: cobrador no puede consultarlos (403)'
    )
    assert(
      (await asAdmin('/api/reportes/mensual')).status === 400,
      'reportes: mensual sin mes/anio -> 400 (Zod)'
    )

    const xlsx = await asAdmin(`/api/reportes/exportar/excel?tipo=diario&fecha=${hoy}`)
    assert(xlsx.status === 200, `exportar Excel -> 200 (status: ${xlsx.status})`)
    assert(
      (xlsx.headers.get('content-type') ?? '').includes('spreadsheetml'),
      'exportar Excel: content-type xlsx'
    )
    const xlsxBytes = Buffer.from(await xlsx.arrayBuffer())
    assert(
      xlsxBytes[0] === 0x50 && xlsxBytes[1] === 0x4b && xlsxBytes.length > 2000,
      `exportar Excel: archivo ZIP/xlsx válido (${xlsxBytes.length} bytes)`
    )

    const pdf = await asAdmin(`/api/reportes/exportar/pdf?tipo=diario&fecha=${hoy}`)
    assert(pdf.status === 200, `exportar PDF -> 200 (status: ${pdf.status})`)
    const pdfBytes = Buffer.from(await pdf.arrayBuffer())
    assert(
      pdfBytes.subarray(0, 4).toString() === '%PDF' && pdfBytes.length > 1000,
      `exportar PDF: archivo PDF válido (${pdfBytes.length} bytes)`
    )

    // ---- Sprint 7: configuración del negocio + dashboard (ADMIN) ----
    const cfg0 = (await (await asAdmin('/api/config')).json()) as ConfigResponse
    assert(
      cfg0.business_name === 'Mi Negocio' && cfg0.currency_symbol === '$',
      'config: valores por defecto'
    )
    assert((await asCajero('/api/config')).status === 403, 'config: cobrador no puede leerla (403)')

    const cfgUpd = await asAdmin('/api/config', 'PUT', {
      business_name: 'Café Central',
      currency_symbol: 'MX$',
      logo_path: 'intento-de-hackeo' // clave no editable por PUT
    })
    assert(cfgUpd.status === 200, `config PUT -> 200 (status: ${cfgUpd.status})`)
    const cfg1 = (await cfgUpd.json()) as ConfigResponse
    assert(
      cfg1.business_name === 'Café Central' && cfg1.currency_symbol === 'MX$',
      'config: PUT actualiza los campos editables'
    )
    assert(cfg1.logo_path === '', 'config: PUT ignora logo_path (sólo por su endpoint)')

    const logoRes = await fetch(`${base}/api/config/logo`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
      body: (() => {
        const f = new FormData()
        f.append('file', new Blob([png], { type: 'image/png' }), 'logo.png')
        return f
      })()
    })
    assert(logoRes.status === 201, `config logo -> 201 (status: ${logoRes.status})`)
    const { config: cfg2 } = (await logoRes.json()) as { config: ConfigResponse }
    assert(
      cfg2.logo_path.startsWith('config/') && cfg2.logo_path.endsWith('.png'),
      'config: el logo queda en config/*.png'
    )
    assert(
      (await fetch(`${base}/uploads/${cfg2.logo_path}`)).status === 200,
      'config: el logo se sirve en /uploads/'
    )
    // Marca pública (barra superior / login): sin token, refleja nombre y logo.
    const marca = (await (await fetch(`${base}/api/marca`)).json()) as BrandingResponse
    assert(
      marca.businessName === cfg2.business_name && marca.logoPath === cfg2.logo_path,
      'marca: /api/marca es pública y trae el nombre y el logo del negocio'
    )

    // ---- Sistema: respaldos, carpetas del servidor e impresora (ADMIN) ----
    assert((await asCajero('/api/admin/respaldos')).status === 403, 'respaldos: cobrador -> 403')
    const bstatus = (await (await asAdmin('/api/admin/respaldos')).json()) as BackupStatus
    assert(
      bstatus.engine === (PG ? 'pg' : 'sqlite') && bstatus.isDefaultDir,
      `respaldos: estado (motor ${bstatus.engine}, carpeta por defecto)`
    )
    const bdir = join(dir, 'respaldos-elegidos')
    const probe = (await (
      await asAdmin('/api/admin/carpetas/probar', 'POST', { path: bdir })
    ).json()) as { ok: boolean }
    assert(probe.ok && existsSync(bdir), 'carpetas: probar crea la carpeta y confirma escritura')
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      const denied = (await (
        await asAdmin('/api/admin/carpetas/probar', 'POST', { path: '/root/pos-no' })
      ).json()) as { ok: boolean; error?: string }
      assert(!denied.ok && !!denied.error, 'carpetas: carpeta sin permiso -> ok:false con motivo')
    }
    const listing = (await (
      await asAdmin(`/api/admin/carpetas?path=${encodeURIComponent(dir)}`)
    ).json()) as FolderListing
    assert(
      listing.dirs.some((d) => d.name === 'respaldos-elegidos') && listing.parent !== null,
      'carpetas: lista subcarpetas (sin archivos) y permite subir'
    )
    assert(
      (await asAdmin('/api/admin/carpetas?path=relativa')).status === 400,
      'carpetas: ruta relativa -> 400'
    )
    const mk = await asAdmin('/api/admin/carpetas', 'POST', { parent: bdir, name: 'Nueva' })
    assert(
      mk.status === 201 && existsSync(join(bdir, 'Nueva')),
      'carpetas: crear subcarpeta -> 201'
    )
    const badName = await asAdmin('/api/admin/carpetas', 'POST', { parent: bdir, name: '../x' })
    assert(badName.status === 400, 'carpetas: nombre con "/" o ".." -> 400')

    await asAdmin('/api/config', 'PUT', { backup_dir: bdir })
    const run = (await (await asAdmin('/api/admin/respaldos', 'POST')).json()) as BackupRunResponse
    if (PGLITE) {
      assert(run.ok && !!run.skipped, 'respaldo manual: omitido con PGlite')
    } else {
      assert(
        run.ok && !!run.file && existsSync(join(bdir, run.file.name)) && run.file.sizeBytes > 0,
        `respaldo manual: archivo en la carpeta elegida (${run.file?.name ?? run.error})`
      )
      const after = (await (await asAdmin('/api/admin/respaldos')).json()) as BackupStatus
      assert(
        after.dir === bdir && !after.isDefaultDir && after.backups[0]?.name === run.file?.name,
        'respaldos: el estado muestra la carpeta elegida y el último respaldo'
      )
    }
    await asAdmin('/api/config', 'PUT', { backup_dir: '' })

    const printers = (await (
      await asAdmin('/api/admin/impresoras')
    ).json()) as SystemPrintersResponse
    assert(
      printers.supported === (process.platform === 'win32'),
      'impresoras: lista de Windows sólo si el servidor corre en Windows'
    )
    // Impresora de red falsa: un socket TCP que junta lo que llega.
    const received: Buffer[] = []
    const fakePrinter = createServer((sock) => sock.on('data', (d) => received.push(d)))
    await new Promise<void>((r) => fakePrinter.listen(0, '127.0.0.1', r))
    const fakePort = (fakePrinter.address() as AddressInfo).port
    const printed = (await (
      await asAdmin('/api/admin/impresora/prueba', 'POST', {
        interface: `tcp://127.0.0.1:${fakePort}`
      })
    ).json()) as { printed: boolean; error?: string }
    await new Promise((r) => setTimeout(r, 200))
    const bytes = Buffer.concat(received).toString('latin1')
    assert(
      // Acentos en PC858 (Ó = 0xE0, á = 0xA0), no en latin1/UTF-8
      printed.printed && bytes.includes('PRUEBA DE IMPRESI\xe0N') && bytes.includes('est\xa0 bien'),
      `impresora: hoja de prueba por red llega a la impresora (${printed.error ?? 'ok'})`
    )

    // Activada y con conexión: reimprimir llega a la impresora.
    await asAdmin('/api/config', 'PUT', {
      printer_enabled: '1',
      printer_interface: `tcp://127.0.0.1:${fakePort}`
    })
    received.length = 0
    const reprintOk = await asAdmin(`/api/ventas/${sale1.id}/reimprimir`, 'POST')
    await new Promise((r) => setTimeout(r, 200))
    // Ningún renglón pasa de 48 columnas (80 mm): uno de 49 manda el último carácter abajo.
    const ticketLines = Buffer.concat(received)
      .toString('latin1')
      // Quitar los comandos ESC/POS (ESC @, GS V n, ESC x n), que no ocupan columnas.
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b@|\x1dV.|\x1b[\s\S]./g, '')
      .split('\n')
    const wide = ticketLines.filter((l) => l.length > 48)
    assert(
      wide.length === 0 && ticketLines.some((l) => l.startsWith('TOTAL')),
      `ticket: todos los renglones caben en 48 columnas (${wide.length} más anchos)`
    )
    assert(
      reprintOk.status === 200 &&
        Buffer.concat(received).toString('latin1').includes(`Folio: ${sale1.ticketNumber}`),
      `impresora activada: reimprimir llega a la impresora (status ${reprintOk.status})`
    )
    // Apagarla conserva la conexión (para volver a activarla tal cual).
    const off = (await (
      await asAdmin('/api/config', 'PUT', { printer_enabled: '0' })
    ).json()) as ConfigResponse
    assert(
      off.printer_enabled === '0' && off.printer_interface === `tcp://127.0.0.1:${fakePort}`,
      'impresora: desactivarla conserva la conexión configurada'
    )
    assert(
      (await asAdmin(`/api/ventas/${sale1.id}/reimprimir`, 'POST')).status === 409,
      'impresora desactivada: reimprimir -> 409'
    )
    // Activada pero sin elegir impresora: eso sí es un error que hay que avisar.
    await asAdmin('/api/config', 'PUT', { printer_enabled: '1', printer_interface: '' })
    const missing = await asAdmin(`/api/ventas/${sale1.id}/reimprimir`, 'POST')
    assert(
      missing.status === 502,
      `impresora activada sin elegir -> 502 (status ${missing.status})`
    )
    fakePrinter.close()

    // Actualización desde una versión sin printer_enabled: si ya había impresora cargada,
    // el seed la deja activada (no en el '0' por defecto).
    await asAdmin('/api/config', 'PUT', { printer_interface: 'tcp://10.0.0.9:9100' })
    await db.delete(config).where(eq(config.key, 'printer_enabled'))
    await runSeed(db)
    const migrated = (await (await asAdmin('/api/config')).json()) as ConfigResponse
    assert(
      migrated.printer_enabled === '1',
      'seed: instalación previa con impresora -> printer_enabled=1'
    )
    await asAdmin('/api/config', 'PUT', { printer_enabled: '0', printer_interface: '' })
    const noPrinter = (await (
      await asAdmin('/api/admin/impresora/prueba', 'POST', { interface: '' })
    ).json()) as { printed: boolean }
    assert(!noPrinter.printed, 'impresora: prueba sin impresora elegida -> printed:false')

    const dash = (await (await asAdmin('/api/dashboard')).json()) as {
      totalTransactions: number
      byPaymentMethod: { CASH: number }
      recentSales: unknown[]
      openSessions: unknown[]
    }
    assert(
      dash.totalTransactions >= 2,
      `dashboard: cuenta las ventas de hoy (got ${dash.totalTransactions})`
    )
    assert(
      dash.byPaymentMethod.CASH === 50,
      `dashboard: desglose por método (efectivo ${dash.byPaymentMethod.CASH})`
    )
    assert(dash.recentSales.length <= 5, 'dashboard: máximo 5 ventas recientes')
    assert(Array.isArray(dash.openSessions), 'dashboard: lista de cajas abiertas')
    assert(
      (await asCajero('/api/dashboard')).status === 403,
      'dashboard: cobrador no puede consultarlo (403)'
    )

    // ---- Módulo de cuentas por cobrar ("fiado") ----
    // La caja del cajero se cerró en el Sprint 3: se reabre para vender a crédito y abonar.
    await asCajero('/api/caja/apertura', 'POST', { openingAmount: 100 })

    const cliRes = await asCajero('/api/clientes', 'POST', {
      name: 'Juan Pérez',
      phone: '555-1234'
    })
    assert(cliRes.status === 201, `crear cliente (cobrador) -> 201 (status: ${cliRes.status})`)
    const juan = (await cliRes.json()) as { id: number }
    const clientes = (await (await asCajero('/api/clientes')).json()) as CustomerWithBalance[]
    assert(
      clientes.some((c) => c.id === juan.id) && !('password' in clientes[0]),
      'clientes: la lista incluye al nuevo cliente'
    )

    const sinCliente = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CREDIT'
    })
    assert(sinCliente.status === 400, `fiado sin cliente -> 400 (status: ${sinCliente.status})`)

    const fiado = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CREDIT',
      amountPaid: 10,
      customerId: juan.id
    })
    assert(fiado.status === 201, `venta a crédito -> 201 (status: ${fiado.status})`)
    const fiadoSale = (await fiado.json()) as CreateSaleResponse
    assert(
      fiadoSale.total === 25 && fiadoSale.amountPaid === 10 && !!fiadoSale.creditAccountId,
      'fiado: venta $25, abono inicial $10, cuenta abierta'
    )
    const accountId = fiadoSale.creditAccountId!

    const cuentas = (await (
      await asCajero('/api/cuentas?status=OPEN')
    ).json()) as CreditAccountListItem[]
    assert(
      cuentas.length === 1 && cuentas[0].id === accountId && cuentas[0].balance === 15,
      `cuentas: 1 cuenta abierta, saldo $15 (got ${cuentas[0]?.balance})`
    )

    // No se puede desactivar un cliente con cuentas abiertas.
    const delOpen = await asAdmin(`/api/clientes/${juan.id}`, 'DELETE')
    assert(
      delOpen.status === 409,
      `desactivar cliente con deuda -> 409 (status: ${delOpen.status})`
    )

    const cuentaDetalle = (await (
      await asCajero(`/api/cuentas/${accountId}`)
    ).json()) as CreditAccountDetail
    assert(
      cuentaDetalle.sale?.ticketNumber != null && cuentaDetalle.payments.length === 0,
      'cuenta: el detalle trae la venta origen y sin abonos aún'
    )

    const ab1 = await asCajero(`/api/cuentas/${accountId}/abono`, 'POST', {
      amount: 5,
      paymentMethod: 'CASH'
    })
    assert(ab1.status === 201, `abono parcial -> 201 (status: ${ab1.status})`)
    const d1 = (await ab1.json()) as CreditAccountDetail
    assert(d1.paid === 5 && d1.balance === 10 && d1.status === 'OPEN', 'abono: saldo baja a $10')

    const abExcede = await asCajero(`/api/cuentas/${accountId}/abono`, 'POST', {
      amount: 20,
      paymentMethod: 'CASH'
    })
    assert(abExcede.status === 400, `abono que supera el saldo -> 400 (status: ${abExcede.status})`)

    const ab2 = await asCajero(`/api/cuentas/${accountId}/abono`, 'POST', {
      amount: 10,
      paymentMethod: 'CASH'
    })
    const d2 = (await ab2.json()) as CreditAccountDetail
    assert(
      d2.status === 'PAID' && d2.balance === 0 && d2.closedAt != null,
      'abono: liquida la cuenta (status PAID, saldo 0)'
    )

    const abPagada = await asCajero(`/api/cuentas/${accountId}/abono`, 'POST', {
      amount: 1,
      paymentMethod: 'CASH'
    })
    assert(abPagada.status === 409, `abono a cuenta liquidada -> 409 (status: ${abPagada.status})`)

    // El corte del turno cuenta el abono inicial y los abonos en efectivo.
    const resumenFiado = (await (await asCajero('/api/caja/resumen')).json()) as CashSessionSummary
    assert(
      resumenFiado.totalCredit === 15 && resumenFiado.abonosCash === 15,
      `corte: crédito otorgado $15, abonos en efectivo $15 (got ${resumenFiado.totalCredit}/${resumenFiado.abonosCash})`
    )
    // apertura 100 + ventas efectivo 0 + abono inicial 10 + abonos efectivo 15 = 125
    assert(
      resumenFiado.expectedCash === 125,
      `corte: efectivo esperado $125 con fiado y abonos (got ${resumenFiado.expectedCash})`
    )

    assert(
      typeof ((await (await asAdmin('/api/dashboard')).json()) as { cuentasPorCobrar: number })
        .cuentasPorCobrar === 'number',
      'dashboard: expone el total por cobrar'
    )

    assert(
      (await asCajero('/api/clientes/' + juan.id, 'DELETE')).status === 403,
      'clientes: el cobrador no puede desactivar (403)'
    )

    // ---- Edición de precio en el momento de la venta (descuento a cliente) ----
    const ventaDescuento = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1, price: 20 }],
      paymentMethod: 'CASH',
      amountPaid: 20
    })
    assert(
      ventaDescuento.status === 201,
      `venta con precio editado -> 201 (status: ${ventaDescuento.status})`
    )
    const saleDescuento = (await ventaDescuento.json()) as CreateSaleResponse
    assert(
      saleDescuento.total === 20 &&
        saleDescuento.items[0].price === 20 &&
        saleDescuento.items[0].originalPrice === 25 &&
        saleDescuento.items[0].subtotal === 20,
      `venta con precio editado: cobra $20, guarda precio original $25 (got ${JSON.stringify(saleDescuento.items[0])})`
    )

    const ventaSinEditar = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CASH',
      amountPaid: 25
    })
    const saleSinEditar = (await ventaSinEditar.json()) as CreateSaleResponse
    assert(
      saleSinEditar.items[0].originalPrice === null,
      'venta sin editar: originalPrice queda en null'
    )

    const ventaPrecioInvalido = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1, price: 0 }],
      paymentMethod: 'CASH',
      amountPaid: 25
    })
    assert(
      ventaPrecioInvalido.status === 400,
      `venta con precio editado inválido (0) -> 400 (status: ${ventaPrecioInvalido.status})`
    )

    const ventaPrecioArriba = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1, price: 999 }],
      paymentMethod: 'CASH',
      amountPaid: 999
    })
    assert(
      ventaPrecioArriba.status === 400,
      `venta con precio editado por encima del catálogo -> 400 (status: ${ventaPrecioArriba.status})`
    )

    // ---- Tope de descuento por línea (config del negocio) ----
    await asAdmin('/api/config', 'PUT', { max_line_discount_pct: '10' })
    const ventaDescuentoGrande = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1, price: 20 }], // catálogo 25 → 20% descuento
      paymentMethod: 'CASH',
      amountPaid: 20
    })
    assert(
      ventaDescuentoGrande.status === 400,
      `venta con descuento > máximo permitido -> 400 (status: ${ventaDescuentoGrande.status})`
    )
    const ventaDescuentoOk = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1, price: 23 }], // 8% descuento, dentro del 10%
      paymentMethod: 'CASH',
      amountPaid: 23
    })
    assert(
      ventaDescuentoOk.status === 201,
      `venta con descuento dentro del máximo -> 201 (status: ${ventaDescuentoOk.status})`
    )
    await asAdmin('/api/config', 'PUT', { max_line_discount_pct: '100' })

    // ---- Importes grandes / centavos: sin deriva de coma flotante ----
    const costalRes = await asAdmin('/api/productos', 'POST', {
      name: 'Costal de papa',
      price: 249.99,
      categoryId: null
    })
    const costal = (await costalRes.json()) as ProductWithCategory
    assert(
      costal.price === 249.99,
      `producto $249.99 se guarda y devuelve exacto (got ${costal.price})`
    )
    const ventaCostal = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: costal.id, quantity: 37 }],
      paymentMethod: 'CASH',
      amountPaid: 9250
    })
    const saleCostal = (await ventaCostal.json()) as CreateSaleResponse
    assert(
      saleCostal.total === 9249.63 && saleCostal.change === 0.37,
      `venta 37 × $249.99 = $9249.63 exacto, cambio $0.37 (got ${saleCostal.total}/${saleCostal.change})`
    )

    // ---- Idempotencia: el mismo clientRequestId no crea dos ventas ----
    const idemBody = {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CASH' as const,
      amountPaid: 25,
      clientRequestId: 'test-req-' + Date.now()
    }
    const idem1 = await asCajero('/api/ventas', 'POST', idemBody)
    const idem2 = await asCajero('/api/ventas', 'POST', idemBody)
    const s1 = (await idem1.json()) as CreateSaleResponse
    const s2 = (await idem2.json()) as CreateSaleResponse & { duplicate?: boolean }
    assert(
      idem1.status === 201 && idem2.status === 200 && s1.id === s2.id && s2.duplicate === true,
      `idempotencia: el reintento devuelve la misma venta (${s1.id}/${s2.id}, dup=${s2.duplicate})`
    )

    // ---- Productos por peso (KG) — cantidades fraccionarias en gramos ----
    const papaRes = await asAdmin('/api/productos', 'POST', {
      name: 'Papa',
      price: 12,
      unit: 'KG',
      categoryId: null
    })
    assert(papaRes.status === 201, `crear producto por kg -> 201 (status: ${papaRes.status})`)
    const papa = (await papaRes.json()) as ProductWithCategory
    assert(papa.unit === 'KG', 'producto: unit KG se guarda')

    const ventaPapa = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: papa.id, quantity: 0.35 }],
      paymentMethod: 'CASH',
      amountPaid: 5
    })
    assert(ventaPapa.status === 201, `venta por peso (350g) -> 201 (status: ${ventaPapa.status})`)
    const salePapa = (await ventaPapa.json()) as CreateSaleResponse
    assert(
      salePapa.items[0].unit === 'KG' &&
        salePapa.items[0].quantity === 0.35 &&
        salePapa.items[0].subtotal === 4.2,
      `venta por peso: 0.35 kg × $12 = $4.20 (got ${JSON.stringify(salePapa.items[0])})`
    )
    const mixta = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [
          { productId: papa.id, quantity: 0.35 },
          { productId: producto.id, quantity: 2 }
        ],
        paymentMethod: 'CARD'
      })
    ).json()) as CreateSaleResponse
    const filaMixta = (
      (await (await asAdmin('/api/ventas?pageSize=100')).json()) as SalesPage
    ).rows.find((r) => r.id === mixta.id)
    assert(
      filaMixta?.itemCount === 2,
      `artículos: 2 piezas + 350 g = 2 productos, no 2.35 ni 3 (got ${filaMixta?.itemCount})`
    )

    const ventaPapaEntera = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1.5 }],
      paymentMethod: 'CASH',
      amountPaid: 40
    })
    assert(
      ventaPapaEntera.status === 400,
      `venta con cantidad fraccionaria para producto por pieza -> 400 (status: ${ventaPapaEntera.status})`
    )

    // ---- Cliente asociado a cualquier venta (no sólo fiado) ----
    const ventaConCliente = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CASH',
      amountPaid: 25,
      customerId: juan.id
    })
    assert(
      ventaConCliente.status === 201,
      `venta en efectivo con cliente -> 201 (status: ${ventaConCliente.status})`
    )
    const saleConCliente = (await ventaConCliente.json()) as CreateSaleResponse
    assert(
      saleConCliente.customerId === juan.id && saleConCliente.customerName === 'Juan Pérez',
      `venta: guarda cliente y resuelve su nombre (got ${saleConCliente.customerId}/${saleConCliente.customerName})`
    )

    const ventaSinCliente = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CASH',
      amountPaid: 25
    })
    const saleSinCliente = (await ventaSinCliente.json()) as CreateSaleResponse
    assert(
      saleSinCliente.customerId === null && saleSinCliente.customerName === null,
      'venta: sin cliente, customerId/customerName quedan en null'
    )

    const ventaClienteInvalido = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1 }],
      paymentMethod: 'CASH',
      amountPaid: 25,
      customerId: 999999
    })
    assert(
      ventaClienteInvalido.status === 400,
      `venta con cliente inexistente -> 400 (status: ${ventaClienteInvalido.status})`
    )

    const ventasConClienteHist = (await (
      await asAdmin(`/api/ventas?userId=${cajeroToken.user.id}`)
    ).json()) as SalesPage
    assert(
      ventasConClienteHist.rows.some((r) => r.customerName === 'Juan Pérez'),
      'historial de ventas: expone customerName cuando la venta tiene cliente'
    )

    // ---- Ticket (sólo texto) + cajón de dinero ----
    // Impresora falsa: junta cada trabajo que llega. El cajón es `ESC p 0 25 250` en el pin 2.
    const jobs: Buffer[] = []
    const cajonPrinter = createServer((sock) => {
      const parts: Buffer[] = []
      sock.on('data', (d) => parts.push(d))
      // La librería abre una conexión vacía para ver si la impresora responde: no cuenta.
      sock.on('end', () => {
        const job = Buffer.concat(parts)
        if (job.length) jobs.push(job)
      })
    })
    await new Promise<void>((r) => cajonPrinter.listen(0, '127.0.0.1', r))
    const cajonPort = (cajonPrinter.address() as AddressInfo).port
    const KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])
    const lastJob = async (): Promise<Buffer> => {
      await new Promise((r) => setTimeout(r, 250))
      return jobs.at(-1) ?? Buffer.alloc(0)
    }
    await asAdmin('/api/config', 'PUT', {
      printer_enabled: '1',
      printer_interface: `tcp://127.0.0.1:${cajonPort}`,
      cash_drawer: '1'
    })
    assert(
      ((await (await asCajero('/api/caja/cajon')).json()) as { enabled: boolean }).enabled,
      'cajón: el cobrador sabe que hay cajón (muestra el botón)'
    )

    const ticketCash = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [{ productId: producto.id, quantity: 1 }],
        paymentMethod: 'CASH',
        amountPaid: 100
      })
    ).json()) as CreateSaleResponse
    const cashJob = await lastJob()
    const cashText = cashJob.toString('latin1')
    assert(
      ticketCash.print.printed && cashJob.includes(KICK),
      'venta en efectivo: el ticket abre el cajón'
    )
    assert(
      [
        `Folio: ${ticketCash.ticketNumber}`,
        `Turno de caja: ${ticketCash.cashSessionId}`,
        'Cobrador: cajero',
        'Efectivo',
        'Recibido',
        'Cambio'
      ].every((t) => cashText.includes(t)) && !cashText.includes('CASH'),
      'ticket: folio, turno de caja, cobrador y pago en español'
    )
    assert(
      !cashJob.includes(Buffer.from([0x1d, 0x76, 0x30])),
      'ticket: sin imagen (sólo texto, no gasta en logo)'
    )

    const ticketCard = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [{ productId: producto.id, quantity: 1 }],
        paymentMethod: 'CARD'
      })
    ).json()) as CreateSaleResponse
    const cardJob = await lastJob()
    assert(
      ticketCard.print.printed &&
        !cardJob.includes(KICK) &&
        cardJob.toString('latin1').includes('Tarjeta'),
      'venta con tarjeta: imprime pero NO abre el cajón'
    )

    await asAdmin(`/api/ventas/${ticketCash.id}/reimprimir`, 'POST')
    const reprintJob = await lastJob()
    assert(!reprintJob.includes(KICK), 'reimpresión: no abre el cajón')
    assert(
      reprintJob.toString('latin1').includes('*** REIMPRESI\xe0N ***') &&
        reprintJob.toString('latin1').includes('Reimpreso: '),
      'reimpresión: el ticket dice que es copia y cuándo se reimprimió'
    )

    const fiadoTicket = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [{ productId: producto.id, quantity: 2 }],
        paymentMethod: 'CREDIT',
        customerId: juan.id,
        amountPaid: 5
      })
    ).json()) as CreateSaleResponse
    const fiadoText = (await lastJob()).toString('latin1')
    assert(
      jobs.at(-1)!.includes(KICK) &&
        fiadoText.includes('Fiado') &&
        fiadoText.includes('Enganche') &&
        fiadoText.includes('Queda a deber') &&
        fiadoText.includes('Cliente: Juan'),
      'venta fiada con enganche: abre el cajón y el ticket dice cuánto queda a deber'
    )

    const nJobs = jobs.length
    await asCajero(`/api/cuentas/${fiadoTicket.creditAccountId}/abono`, 'POST', {
      amount: 1,
      paymentMethod: 'TRANSFER'
    })
    await new Promise((r) => setTimeout(r, 250))
    assert(jobs.length === nJobs, 'abono por transferencia: no abre el cajón')
    const abonoCash = await asCajero(`/api/cuentas/${fiadoTicket.creditAccountId}/abono`, 'POST', {
      amount: 1,
      paymentMethod: 'CASH'
    })
    const abonoJob = await lastJob()
    assert(
      jobs.length === nJobs + 1 && abonoJob.includes(KICK),
      `abono en efectivo: abre el cajón (status ${abonoCash.status}, trabajos ${jobs.length - nJobs})`
    )

    await asCajero('/api/caja/movimiento', 'POST', { type: 'IN', amount: 50, reason: 'Cambio' })
    assert((await lastJob()).includes(KICK), 'ingreso de efectivo: abre el cajón')

    const manual = (await (await asCajero('/api/caja/cajon', 'POST', {})).json()) as DrawerResult
    assert(manual.opened && (await lastJob()).includes(KICK), 'botón "Cajón" del cobrador: lo abre')

    const pruebaCajon = (await (
      await asAdmin('/api/admin/impresora/cajon', 'POST', {
        interface: `tcp://127.0.0.1:${cajonPort}`
      })
    ).json()) as DrawerResult
    assert(pruebaCajon.opened && (await lastJob()).includes(KICK), 'Configuración: "Probar cajón"')

    // ---- Agregar productos olvidados a una venta ya cobrada (mismo folio) ----
    const resumenAntes = (await (await asCajero('/api/caja/resumen')).json()) as CashSessionSummary
    // El cierre muestra cada renglón: su suma debe dar el efectivo esperado (antes faltaban
    // los enganches de fiado y el desglose no cuadraba con el total).
    const r = resumenAntes
    const sumaRenglones =
      r.session.openingAmount + r.totalCash + r.creditDownCash + r.abonosCash + r.cashIn - r.cashOut
    assert(
      r.creditDownCash > 0 && Math.round(sumaRenglones * 100) === Math.round(r.expectedCash * 100),
      `cierre: los renglones (incl. enganches ${r.creditDownCash}) suman el esperado ${r.expectedCash}`
    )
    const baseSale = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [{ productId: producto.id, quantity: 1 }],
        paymentMethod: 'CASH',
        amountPaid: 30
      })
    ).json()) as CreateSaleResponse
    const agregar = (saleId: number, body: unknown, as = asCajero): Promise<Response> =>
      as(`/api/ventas/${saleId}/agregar`, 'POST', body)

    const corto = await agregar(baseSale.id, {
      items: [{ productId: papa.id, quantity: 0.5 }],
      amountPaid: 1
    })
    assert(corto.status === 400, `agregar: efectivo insuficiente -> 400 (status ${corto.status})`)
    const vacio = await agregar(baseSale.id, { items: [] })
    assert(vacio.status === 400, `agregar: sin productos -> 400 (status ${vacio.status})`)

    const addReq = {
      items: [{ productId: papa.id, quantity: 0.5 }],
      amountPaid: 10,
      clientRequestId: 'agregar-prueba-0001'
    }
    const addRes = await agregar(baseSale.id, addReq)
    const added = (await addRes.json()) as AddToSaleResponse
    const addJob = await lastJob()
    assert(
      addRes.status === 200 &&
        added.id === baseSale.id &&
        added.ticketNumber === baseSale.ticketNumber &&
        added.total === 31 &&
        added.addedTotal === 6 &&
        added.addedChange === 4 &&
        added.amountPaid === 40 &&
        added.change === 9,
      `agregar (efectivo): mismo folio, total 25+6=31, recibido 40, cambio 5+4=9 (got ${added.total}/${added.amountPaid}/${added.change})`
    )
    assert(
      added.items.length === 2 &&
        added.items.find((i) => i.productId === producto.id)?.addedAt === null &&
        (added.items.find((i) => i.productId === papa.id)?.addedAt ?? 0) > 0,
      'agregar: las líneas nuevas quedan marcadas con la hora en que se agregaron'
    )
    const addText = addJob.toString('latin1')
    assert(
      added.print.printed &&
        addJob.includes(KICK) &&
        addText.includes('TICKET ACTUALIZADO') &&
        addText.includes(`Folio: ${baseSale.ticketNumber}`) &&
        addText.includes('500g x Papa'),
      'agregar (efectivo): sale un ticket actualizado con todo y abre el cajón'
    )
    const dupAdd = await agregar(baseSale.id, addReq)
    const dupBody = (await dupAdd.json()) as AddToSaleResponse
    assert(
      dupAdd.status === 200 && dupBody.duplicate === true && dupBody.total === 31,
      `agregar: un doble clic no agrega dos veces (total ${dupBody.total})`
    )
    const resumenDespues = (await (
      await asCajero('/api/caja/resumen')
    ).json()) as CashSessionSummary
    assert(
      resumenDespues.salesCount === resumenAntes.salesCount + 1 &&
        Math.round((resumenDespues.totalCash - resumenAntes.totalCash) * 100) === 3100 &&
        Math.round((resumenDespues.expectedCash - resumenAntes.expectedCash) * 100) === 3100,
      `agregar: cuenta como UNA venta y el efectivo esperado sube 31 (ventas +${resumenDespues.salesCount - resumenAntes.salesCount})`
    )

    const cardBase = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [{ productId: producto.id, quantity: 1 }],
        paymentMethod: 'CARD'
      })
    ).json()) as CreateSaleResponse
    const cardAdd = (await (
      await agregar(cardBase.id, { items: [{ productId: producto.id, quantity: 2 }] })
    ).json()) as AddToSaleResponse
    assert(
      cardAdd.total === 75 &&
        cardAdd.paymentMethod === 'CARD' &&
        cardAdd.amountPaid === null &&
        !(await lastJob()).includes(KICK),
      `agregar (tarjeta): mismo método, total 25+50=75, no abre el cajón (got ${cardAdd.total})`
    )

    const deudaDe = async (): Promise<number> =>
      ((await (await asCajero('/api/clientes')).json()) as CustomerWithBalance[]).find(
        (c) => c.id === juan.id
      )!.balance
    const deudaAntes = await deudaDe()
    const fiadoAdd = await agregar(fiadoTicket.id, {
      items: [{ productId: producto.id, quantity: 1 }]
    })
    assert(
      fiadoAdd.status === 200 &&
        Math.round(((await deudaDe()) - deudaAntes) * 100) === 2500 &&
        !(await lastJob()).includes(KICK),
      `agregar (fiado): lo agregado se suma a lo que debe el cliente (status ${fiadoAdd.status})`
    )

    const cerrada = await agregar(sale1.id, { items: [{ productId: producto.id, quantity: 1 }] })
    assert(
      cerrada.status === 409,
      `agregar a una venta de una caja cerrada -> 409 (status ${cerrada.status})`
    )
    const porAdmin = await agregar(
      cardBase.id,
      { items: [{ productId: producto.id, quantity: 1 }] },
      asAdmin
    )
    assert(
      porAdmin.status === 200,
      `agregar: el admin puede en cualquier caja abierta (${porAdmin.status})`
    )

    // Otro cobrador: no toca ventas ajenas ni reimprime tickets de otra caja.
    await asAdmin('/api/usuarios', 'POST', {
      username: 'cajero3',
      password: 'secreto123',
      role: 'COBRADOR'
    })
    const cajero3 = (await (await login('cajero3', 'secreto123')).json()) as LoginResponse
    const asCajero3 = call(cajero3.token)
    await asCajero3('/api/caja/apertura', 'POST', { openingAmount: 100 })
    const ajena = await agregar(
      baseSale.id,
      { items: [{ productId: producto.id, quantity: 1 }], amountPaid: 25 },
      asCajero3
    )
    assert(ajena.status === 403, `agregar a una venta de otra caja -> 403 (status ${ajena.status})`)
    const turno3 = (await (await asCajero3('/api/ventas/turno')).json()) as TurnSale[]
    assert(
      turno3.length === 0,
      `ventas del turno: cada cobrador ve sólo su caja (${turno3.length})`
    )

    // Ventas del turno + reimpresión del cobrador (sólo la última de su caja).
    const turno = (await (await asCajero('/api/ventas/turno')).json()) as TurnSale[]
    const ultima = turno[0]
    assert(
      turno.length > 3 &&
        turno.every((t) => t.cashSessionId === baseSale.cashSessionId) &&
        turno.filter((t) => t.canReprint).length === 1 &&
        ultima.canReprint,
      `ventas del turno: de la más nueva a la más vieja, sólo la última reimprimible (${turno.length})`
    )
    const turnoAdmin = (await (await asAdmin('/api/ventas/turno')).json()) as TurnSale[]
    assert(
      turnoAdmin.length >= turno.length && turnoAdmin.every((t) => t.canReprint),
      'ventas del turno (admin): todas las cajas abiertas, puede reimprimir cualquiera'
    )
    const vieja = await asCajero(`/api/ventas/${baseSale.id}/reimprimir`, 'POST')
    assert(
      vieja.status === 403,
      `cobrador: reimprimir un ticket viejo -> 403 (status ${vieja.status})`
    )
    const ajenaReimp = await asCajero3(`/api/ventas/${ultima.id}/reimprimir`, 'POST')
    assert(
      ajenaReimp.status === 403,
      `cobrador: reimprimir el ticket de otra caja -> 403 (status ${ajenaReimp.status})`
    )
    const propia = await asCajero(`/api/ventas/${ultima.id}/reimprimir`, 'POST')
    assert(
      propia.status === 200 && (await lastJob()).toString('latin1').includes('REIMPRESI'),
      `cobrador: reimprime su último ticket, marcado como copia (status ${propia.status})`
    )
    const cajero3Id = cajero3.user.id
    const conCaja = await asAdmin(`/api/usuarios/${cajero3Id}`, 'DELETE')
    assert(
      conCaja.status === 409,
      `usuarios: no se desactiva a quien tiene la caja abierta (status ${conCaja.status})`
    )
    await asCajero3('/api/caja/cierre', 'POST', { closingAmount: 100 })
    await asAdmin(`/api/usuarios/${cajero3Id}`, 'DELETE')
    const tokenViejo = await asCajero3('/api/ventas/turno')
    assert(
      tokenViejo.status === 401,
      `usuario desactivado: su sesión abierta deja de servir de inmediato (status ${tokenViejo.status})`
    )

    // Reimpresión de un fiado: además de lo que quedó a deber, el saldo de hoy (tras abonos).
    await asAdmin(`/api/ventas/${fiadoTicket.id}/reimprimir`, 'POST')
    const fiadoCopia = (await lastJob()).toString('latin1')
    assert(
      fiadoCopia.includes('Queda a deber') && fiadoCopia.includes('Saldo actual'),
      'reimpresión de fiado: muestra el saldo actual además de lo que quedó a deber'
    )

    // Vista previa del ticket (Imprimir → PDF): mismos renglones que la impresora.
    type Preview = { lines: { text: string; align: string; bold: boolean }[] }
    const previa = (await (await asAdmin(`/api/ventas/${fiadoTicket.id}/ticket`)).json()) as Preview
    assert(
      previa.lines.some((l) => l.text.includes('REIMPRESIÓN')) &&
        previa.lines.some((l) => l.text.startsWith('TOTAL') && l.bold) &&
        previa.lines.every((l) => l.text.length <= 48),
      'vista previa: la venta sale como copia, con TOTAL en negritas y a 48 columnas'
    )
    const ejemplo = (await (await asAdmin('/api/admin/impresora/ticket-ejemplo')).json()) as Preview
    assert(
      ejemplo.lines.some((l) => l.text === 'TICKET DE EJEMPLO') &&
        ejemplo.lines.some((l) => l.text.includes('Producto de prueba')) &&
        ejemplo.lines.some((l) => l.text.startsWith('Cambio')) &&
        ejemplo.lines.every((l) => l.text.length <= 48),
      'ticket de ejemplo: con productos del catálogo, marcado como ejemplo, 48 columnas'
    )
    assert(
      (await asCajero('/api/admin/impresora/ticket-ejemplo')).status === 403,
      'ticket de ejemplo: sólo el admin'
    )

    // Importes con separador de miles, como se leen en México.
    assert(
      formatMoney(2578.75) === '$2,578.75' &&
        formatMoney(1234567.5) === '$1,234,567.50' &&
        formatMoney(999.99) === '$999.99' &&
        formatMoney(-5.75) === '−$5.75' &&
        formatMoney(-0.001) === '$0.00',
      'importes: separador de miles y signo menos al frente'
    )

    // Mensajes de validación en español y con el campo, no el texto técnico de Zod.
    const sinNombre = (await (
      await asAdmin('/api/productos', 'POST', { name: '', price: 10, categoryId: null })
    ).json()) as { error: string }
    assert(
      sinNombre.error === 'El nombre no puede ir vacío.',
      `validación: mensaje en español con el campo (got "${sinNombre.error}")`
    )
    const precioNeg = (await (
      await asAdmin('/api/productos', 'POST', { name: 'X', price: -1, categoryId: null })
    ).json()) as { error: string }
    assert(
      precioNeg.error === 'El precio debe ser mayor o igual a 0.',
      `validación: precio negativo explicado (got "${precioNeg.error}")`
    )

    // Nombres de producto: dos activos no pueden llamarse igual (sin importar mayúsculas).
    const dupNombre = await asAdmin('/api/productos', 'POST', {
      name: '  producto   DE prueba ',
      price: 10,
      categoryId: null
    })
    assert(
      dupNombre.status === 409,
      `productos: nombre repetido (mayúsculas/espacios) -> 409 (status ${dupNombre.status})`
    )

    await asAdmin('/api/config', 'PUT', { cash_drawer: '0' })
    const sinCajon = (await (await asCajero('/api/caja/cajon', 'POST', {})).json()) as DrawerResult
    assert(
      sinCajon.skipped === true &&
        !((await (await asCajero('/api/caja/cajon')).json()) as { enabled: boolean }).enabled,
      'sin cajón configurado: el botón no aparece y no se manda nada'
    )
    await asAdmin('/api/config', 'PUT', { printer_enabled: '0', printer_interface: '' })
    cajonPrinter.close()

    // ---- Importación de productos (Excel / catálogo base) ----
    const plantilla = await asAdmin('/api/productos/plantilla')
    assert(
      plantilla.status === 200 &&
        (plantilla.headers.get('content-type') ?? '').includes('spreadsheetml'),
      `importar: plantilla .xlsx (status ${plantilla.status})`
    )
    assert((await asCajero('/api/productos/plantilla')).status === 403, 'importar: sólo el admin')
    const xlsxForm = new FormData()
    xlsxForm.append('file', new Blob([await plantilla.arrayBuffer()]), 'plantilla.xlsx')
    const leidas = (await (
      await fetch(`${base}/api/productos/importar/leer`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}` },
        body: xlsxForm
      })
    ).json()) as ParsedImportSheet
    assert(
      leidas.rows.length === 2 &&
        leidas.rows[0].item?.barcode === '7501055300075' &&
        leidas.rows[0].item?.price === 20 &&
        leidas.rows[1].item?.unit === 'KG',
      `importar: lee la plantilla (código como texto, precio, Kg) (${JSON.stringify(leidas.rows)})`
    )
    const csvForm = new FormData()
    csvForm.append(
      'file',
      new Blob([
        '\uFEFFProducto;Precio de venta;Departamento;Código de barras\r\n' +
          'Sabritas 45 g;"$1,020.50";Botanas;7501011111111\r\n;;;\r\nSin precio;;;\r\n' +
          'Precio raro;abc;;\r\n'
      ]),
      'lista.csv'
    )
    const csv = (await (
      await fetch(`${base}/api/productos/importar/leer`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}` },
        body: csvForm
      })
    ).json()) as ParsedImportSheet
    assert(
      csv.rows.length === 2 &&
        csv.rows[0].item?.price === 1020.5 &&
        csv.rows[0].item?.category === 'Botanas' &&
        csv.withoutPrice === 1 &&
        csv.rows[1].error === 'El precio no es un número válido.' &&
        csv.rows[1].row === 5,
      `importar: CSV con ";", BOM, "$1,020.50", vacío, sin precio (se ignora) y precio inválido (${JSON.stringify(csv)})`
    )

    const lista = [
      {
        name: 'Galletas Marías 170 g',
        price: 18,
        unit: 'PIEZA',
        category: 'Galletas Import',
        barcode: '7500000000001'
      },
      {
        name: 'Frijol a granel',
        price: 38.5,
        unit: 'KG',
        category: 'galletas import',
        barcode: null
      },
      { name: 'producto de prueba', price: 5, unit: 'PIEZA', category: null, barcode: null },
      { name: 'Galletas Marías 170 g', price: 18, unit: 'PIEZA', category: null, barcode: null },
      { name: 'Otro', price: 1, unit: 'PIEZA', category: null, barcode: '7500000000001' },
      { name: '', price: 1, unit: 'PIEZA', category: null, barcode: null },
      { name: 'Precio malo', price: -3, unit: 'PIEZA', category: null, barcode: null }
    ]
    const prodsAntes = ((await (await asAdmin('/api/productos?all=1')).json()) as unknown[]).length
    const simulado = (await (
      await asAdmin('/api/productos/importar', 'POST', { items: lista, dryRun: true })
    ).json()) as ImportProductsResult
    assert(
      simulado.created === 2 &&
        simulado.skipped.map((x) => x.index).join() === '2,3,4,5,6' &&
        simulado.newCategories.join() === 'Galletas Import',
      `importar (vista previa): 2 entran, 5 se explican, categoría sin duplicar por mayúsculas (${JSON.stringify(simulado)})`
    )
    assert(
      ((await (await asAdmin('/api/productos?all=1')).json()) as unknown[]).length === prodsAntes,
      'importar (vista previa): no guarda nada'
    )
    const importado = (await (
      await asAdmin('/api/productos/importar', 'POST', { items: lista })
    ).json()) as ImportProductsResult
    const trasImportar = (await (
      await asAdmin('/api/productos?all=1')
    ).json()) as ProductWithCategory[]
    const frijol = trasImportar.find((p) => p.name === 'Frijol a granel')
    assert(
      importado.created === 2 &&
        trasImportar.length === prodsAntes + 2 &&
        frijol?.unit === 'KG' &&
        frijol.price === 38.5 &&
        frijol.categoryName === 'Galletas Import',
      `importar: guarda 2, con unidad, precio y la misma categoría nueva (${JSON.stringify(frijol)})`
    )
    const repetido = (await (
      await asAdmin('/api/productos/importar', 'POST', { items: lista.slice(0, 2) })
    ).json()) as ImportProductsResult
    assert(
      repetido.created === 0 && repetido.skipped.length === 2,
      'importar: volver a importar la misma lista no duplica nada'
    )

    const catalogos = (await (await asAdmin('/api/catalogos')).json()) as CatalogInfo[]
    const abarrotes = catalogos.find((c) => c.id === 'abarrotes-mx')
    assert(!!abarrotes && abarrotes.count > 1000, `catálogo de abarrotes (${abarrotes?.count})`)
    const catItems = (await (await asAdmin('/api/catalogos/abarrotes-mx')).json()) as CatalogItem[]
    assert(
      catItems.length === abarrotes!.count &&
        catItems.every((c) => c.barcode?.startsWith('750') && c.name.length >= 3),
      'catálogo: todos con código mexicano y nombre'
    )
    assert(
      (await asAdmin('/api/catalogos/no-existe')).status === 404,
      'catálogo inexistente -> 404'
    )

    // Catálogo en Excel (precio vacío) → al subirlo tal cual no entra nada y se cuentan
    // todos como "sin precio"; con precio en un renglón, entra sólo ése.
    const catXlsx = await asAdmin('/api/catalogos/abarrotes-mx/excel')
    assert(catXlsx.status === 200, `catálogo en Excel -> 200 (${catXlsx.status})`)
    const catBytes = await catXlsx.arrayBuffer()
    const subirXlsx = async (bytes: ArrayBuffer): Promise<ParsedImportSheet> => {
      const f = new FormData()
      f.append('file', new Blob([bytes]), 'catalogo.xlsx')
      return (await (
        await fetch(`${base}/api/productos/importar/leer`, {
          method: 'POST',
          headers: { authorization: `Bearer ${session.token}` },
          body: f
        })
      ).json()) as ParsedImportSheet
    }
    const catLeido = await subirXlsx(catBytes)
    assert(
      catLeido.rows.length === 0 && catLeido.withoutPrice === abarrotes!.count,
      `catálogo en Excel sin precios: 0 productos, ${abarrotes!.count} sin precio (${catLeido.rows.length}/${catLeido.withoutPrice}, ${catBytes.byteLength} bytes)`
    )
    const ExcelJS = (await import('exceljs')).default
    const wbCat = new ExcelJS.Workbook()
    await wbCat.xlsx.load(catBytes)
    wbCat.worksheets[0].getCell('B3').value = 23.5
    const conPrecio = await subirXlsx((await wbCat.xlsx.writeBuffer()) as ArrayBuffer)
    assert(
      conPrecio.rows.length === 1 &&
        conPrecio.rows[0].item?.price === 23.5 &&
        conPrecio.rows[0].item?.barcode === catItems[1].barcode &&
        conPrecio.withoutPrice === abarrotes!.count - 1,
      `catálogo en Excel con un precio: entra sólo ése, con su código (${JSON.stringify(conPrecio.rows)})`
    )

    // Alta por código escaneado: datos del catálogo base (sin internet).
    const porCodigo = (await (
      await asAdmin(`/api/catalogos/codigo/${catItems[0].barcode}`)
    ).json()) as BarcodeLookup
    assert(
      porCodigo.source === 'catalogo' && porCodigo.item.name === catItems[0].name,
      `código escaneado: datos del catálogo base (${JSON.stringify(porCodigo)})`
    )
    assert(
      (await asAdmin('/api/catalogos/codigo/abc123')).status === 400,
      'código con letras -> 400 (no se busca afuera)'
    )
    assert(
      (await asCajero(`/api/catalogos/codigo/${catItems[0].barcode}`)).status === 403,
      'buscar datos por código: sólo el admin'
    )

    // ---- Precio libre ("Varios", servicios de papelería) ----
    await asAdmin('/api/config', 'PUT', { max_line_discount_pct: '10' })
    const ventaVarios = await asCajero('/api/ventas', 'POST', {
      items: [
        { productId: varios!.id, quantity: 2, price: 35.5, note: '  Engargolado   azul ' },
        { productId: varios!.id, quantity: 1, price: 3 },
        { productId: producto.id, quantity: 1500 }
      ],
      paymentMethod: 'CASH',
      amountPaid: 40000
    })
    assert(ventaVarios.status === 201, `venta con "Varios" -> 201 (${ventaVarios.status})`)
    const saleVarios = (await ventaVarios.json()) as CreateSaleResponse
    assert(
      saleVarios.items.length === 3 &&
        saleVarios.items[0].name === 'Varios - Engargolado azul' &&
        saleVarios.items[0].subtotal === 71 &&
        saleVarios.items[0].originalPrice === null &&
        saleVarios.items[1].name === 'Varios' &&
        saleVarios.items[2].quantity === 1500 &&
        saleVarios.total === 71 + 3 + 1500 * 25,
      `"Varios": importe libre sin tope de descuento, descripción en el renglón, 1500 piezas (${JSON.stringify(saleVarios.items)})`
    )
    const variosSinImporte = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: varios!.id, quantity: 1 }],
      paymentMethod: 'CASH',
      amountPaid: 10
    })
    assert(
      variosSinImporte.status === 400 &&
        ((await variosSinImporte.json()) as { error: string }).error.includes('importe'),
      `"Varios" sin importe -> 400 (${variosSinImporte.status})`
    )
    const notaLarga = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: varios!.id, quantity: 1, price: 5, note: 'x'.repeat(61) }],
      paymentMethod: 'CASH',
      amountPaid: 10
    })
    assert(
      notaLarga.status === 400,
      `descripción de más de 60 caracteres -> 400 (${notaLarga.status})`
    )
    const notaEnNormal = await asCajero('/api/ventas', 'POST', {
      items: [{ productId: producto.id, quantity: 1, note: 'no aplica' }],
      paymentMethod: 'CASH',
      amountPaid: 25
    })
    const saleNotaEnNormal = (await notaEnNormal.json()) as CreateSaleResponse
    assert(
      notaEnNormal.status === 201 && saleNotaEnNormal.items[0].name === producto.name,
      'la descripción se ignora en productos de precio fijo'
    )
    await asAdmin('/api/config', 'PUT', { max_line_discount_pct: '100' })

    const servicioRes = await asAdmin('/api/productos', 'POST', {
      name: 'Impresión especial',
      price: 0,
      categoryId: null,
      openPrice: true
    })
    const servicio = (await servicioRes.json()) as ProductWithCategory
    assert(
      servicioRes.status === 201 && servicio.openPrice === 1,
      `alta de producto con precio libre (${servicioRes.status})`
    )
    const servicioEditado = (await (
      await asAdmin(`/api/productos/${servicio.id}`, 'PUT', {
        name: 'Impresión especial',
        price: 10,
        categoryId: null
      })
    ).json()) as ProductWithCategory
    assert(
      servicioEditado.openPrice === 1 && servicioEditado.price === 10,
      'editar sin mandar openPrice lo conserva (precio sugerido $10)'
    )
    const servicioSugerido = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [{ productId: servicio.id, quantity: 1 }],
        paymentMethod: 'CASH',
        amountPaid: 10
      })
    ).json()) as CreateSaleResponse
    assert(
      servicioSugerido.total === 10,
      `precio libre sin importe usa el sugerido (${JSON.stringify(servicioSugerido)})`
    )

    // ---- Inventario ----
    const altaInv = async (body: Record<string, unknown>): Promise<ProductWithCategory> =>
      (await (
        await asAdmin('/api/productos', 'POST', { categoryId: null, ...body })
      ).json()) as ProductWithCategory
    const cuaderno = await altaInv({
      name: 'Cuaderno profesional',
      price: 30,
      trackStock: true,
      initialStock: 10,
      minStock: 3
    })
    assert(
      cuaderno.trackStock === 1 && cuaderno.stock === 10 && cuaderno.minStock === 3,
      `alta con inventario: existencia inicial 10, mínimo 3 (${JSON.stringify(cuaderno)})`
    )
    const queso = await altaInv({
      name: 'Queso Oaxaca',
      price: 160,
      unit: 'KG',
      trackStock: true,
      initialStock: 2.5
    })
    const inventario = async (): Promise<InventoryItem[]> =>
      (await (await asAdmin('/api/inventario')).json()) as InventoryItem[]
    const itemDe = async (id: number): Promise<InventoryItem | undefined> =>
      (await inventario()).find((i) => i.id === id)

    const ventaInv = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [
          { productId: cuaderno.id, quantity: 4 },
          { productId: queso.id, quantity: 0.75 },
          { productId: producto.id, quantity: 1 }
        ],
        paymentMethod: 'CASH',
        amountPaid: 1000
      })
    ).json()) as CreateSaleResponse
    assert(
      (await itemDe(cuaderno.id))?.stock === 6 && (await itemDe(queso.id))?.stock === 1.75,
      'venta descuenta existencia: cuaderno 10→6, queso 2.5→1.75 kg'
    )
    assert(
      (await itemDe(producto.id)) === undefined,
      'producto sin inventario no aparece en Inventario'
    )
    const agregado = await asCajero(`/api/ventas/${ventaInv.id}/agregar`, 'POST', {
      items: [{ productId: cuaderno.id, quantity: 4 }],
      amountPaid: 120
    })
    const cuadernoBajo = await itemDe(cuaderno.id)
    assert(
      agregado.status === 200 && cuadernoBajo?.stock === 2 && cuadernoBajo.status === 'LOW',
      `agregar a una venta también descuenta: 6→2, "por agotarse" (${agregado.status}, ${JSON.stringify(cuadernoBajo)})`
    )
    await asCajero('/api/ventas', 'POST', {
      items: [{ productId: cuaderno.id, quantity: 3 }],
      paymentMethod: 'CARD'
    })
    const inv1 = await inventario()
    assert(
      inv1[0].id === cuaderno.id && inv1[0].stock === -1 && inv1[0].status === 'OUT',
      `sin existencia la venta NO se bloquea: queda en -1, "agotado" y primero en la lista (${JSON.stringify(inv1[0])})`
    )
    const dashInv = (await (await asAdmin('/api/dashboard')).json()) as { lowStockCount: number }
    assert(dashInv.lowStockCount === 1, `dashboard: 1 por agotarse (${dashInv.lowStockCount})`)

    const entrada = await asAdmin(`/api/inventario/${cuaderno.id}/entrada`, 'POST', {
      quantity: 12,
      reason: 'Proveedor Norma'
    })
    const trasEntrada = (await entrada.json()) as InventoryItem
    assert(
      entrada.status === 200 && trasEntrada.stock === 11 && trasEntrada.status === 'OK',
      `entrada de 12: -1→11 (${entrada.status}, ${JSON.stringify(trasEntrada)})`
    )
    assert(
      (await asAdmin(`/api/inventario/${cuaderno.id}/entrada`, 'POST', { quantity: 1.5 }))
        .status === 400,
      'entrada con fracción en producto por pieza -> 400'
    )
    assert(
      (await asAdmin(`/api/inventario/${producto.id}/entrada`, 'POST', { quantity: 1 })).status ===
        409,
      'entrada a producto sin inventario -> 409'
    )
    const entradaKg = (await (
      await asAdmin(`/api/inventario/${queso.id}/entrada`, 'POST', { quantity: 0.1 })
    ).json()) as InventoryItem
    assert(entradaKg.stock === 1.85, `entrada en kg sin decimales raros (${entradaKg.stock})`)

    const ajuste = (await (
      await asAdmin(`/api/inventario/${cuaderno.id}/ajuste`, 'POST', { counted: 9 })
    ).json()) as InventoryItem
    assert(ajuste.stock === 9, `ajuste por conteo: 11→9 (${ajuste.stock})`)
    await asAdmin(`/api/inventario/${cuaderno.id}/ajuste`, 'POST', { counted: 9 })
    const movsInv = (await (
      await asAdmin(`/api/inventario/${cuaderno.id}/movimientos`)
    ).json()) as StockMovement[]
    assert(
      movsInv.map((m) => `${m.type}:${m.quantity}:${m.stockAfter}`).join(' ') ===
        'ADJUST:-2:9 ENTRY:12:11 SALE:-3:-1 SALE:-4:2 SALE:-4:6 ADJUST:10:10',
      `historial completo y sin movimiento en un conteo igual (${movsInv.map((m) => `${m.type}:${m.quantity}:${m.stockAfter}`).join(' ')})`
    )
    assert(
      movsInv[0].reason === 'Conteo físico' &&
        movsInv[1].reason === 'Proveedor Norma' &&
        movsInv[4].ticketNumber === ventaInv.ticketNumber &&
        movsInv[5].reason === 'Existencia inicial' &&
        movsInv[0].userName === 'admin' &&
        movsInv[2].userName === 'cajero',
      `movimientos con motivo, folio y usuario (${JSON.stringify(movsInv.slice(0, 5))})`
    )
    assert(
      (await asAdmin(`/api/inventario/${cuaderno.id}/ajuste`, 'POST', { counted: -1 })).status ===
        400,
      'conteo negativo -> 400'
    )

    const activar = (await (
      await asAdmin('/api/inventario/activar', 'POST', { productIds: [producto.id, cuaderno.id] })
    ).json()) as { enabled: number }
    assert(
      activar.enabled === 1,
      `activar inventario en lote: sólo los que no lo llevaban (${activar.enabled})`
    )
    assert(
      (await itemDe(producto.id))?.status === 'OUT',
      'producto activado arranca en 0 (agotado) hasta contarlo'
    )
    const sinInv = (await (
      await asAdmin(`/api/productos/${producto.id}`, 'PUT', {
        name: producto.name,
        price: 25,
        categoryId: producto.categoryId,
        trackStock: false
      })
    ).json()) as ProductWithCategory
    assert(
      sinInv.trackStock === 0 && (await itemDe(producto.id)) === undefined,
      'quitar inventario desde el producto lo saca de la lista'
    )
    const editarSinTocar = (await (
      await asAdmin(`/api/productos/${cuaderno.id}`, 'PUT', {
        name: cuaderno.name,
        price: 32,
        categoryId: null
      })
    ).json()) as ProductWithCategory
    assert(
      editarSinTocar.trackStock === 1 &&
        editarSinTocar.stock === 9 &&
        editarSinTocar.minStock === 3,
      'editar el producto sin mandar inventario no toca existencia ni mínimo'
    )
    assert(
      (await asCajero('/api/inventario')).status === 403 &&
        (await asCajero(`/api/inventario/${cuaderno.id}/entrada`, 'POST', { quantity: 1 }))
          .status === 403,
      'inventario: sólo el administrador'
    )

    // ---- Pollería: opciones, paquetes, notas y encargos ----
    const pollo = await altaInv({
      name: 'Pollo crudo',
      price: 70,
      trackStock: true,
      initialStock: 20
    })
    const tortillas = await altaInv({
      name: 'Tortillas 1 kg',
      price: 25,
      trackStock: true,
      initialStock: 50
    })
    const tipos = [
      { groupName: 'Tipo de pollo', name: 'Natural', price: 0 },
      { groupName: 'Tipo de pollo', name: 'Adobado', price: 0 },
      { groupName: 'Tipo de pollo', name: 'Al carbón', price: 10 }
    ]
    const entero = await altaInv({
      name: 'Pollo entero',
      price: 180,
      options: tipos,
      components: [{ componentId: pollo.id, quantity: 1 }]
    })
    assert(
      entero.options.length === 3 &&
        entero.options[2].name === 'Al carbón' &&
        entero.options[2].price === 10 &&
        entero.components[0]?.componentId === pollo.id,
      `alta con opciones y contenido (${JSON.stringify(entero)})`
    )
    const medio = await altaInv({
      name: 'Medio pollo',
      price: 95,
      options: tipos,
      components: [{ componentId: pollo.id, quantity: 0.5 }]
    })
    const familiar = await altaInv({
      name: 'Paquete familiar',
      price: 260,
      options: tipos,
      components: [
        { componentId: pollo.id, quantity: 1 },
        { componentId: tortillas.id, quantity: 1 }
      ]
    })
    const anidado = await asAdmin('/api/productos', 'POST', {
      name: 'Paquete doble',
      price: 400,
      categoryId: null,
      components: [{ componentId: familiar.id, quantity: 2 }]
    })
    assert(anidado.status === 400, `un paquete no puede llevar otro paquete (${anidado.status})`)
    const libreConOpciones = await asAdmin('/api/productos', 'POST', {
      name: 'Libre con opciones',
      price: 0,
      categoryId: null,
      openPrice: true,
      options: tipos
    })
    assert(libreConOpciones.status === 400, 'precio libre no lleva opciones -> 400')

    const catalogoCaja = (await (await asCajero('/api/productos')).json()) as ProductWithCategory[]
    assert(
      !catalogoCaja.some((p) => p.name === 'Anticipo de encargo') &&
        catalogoCaja.find((p) => p.id === medio.id)?.options.length === 3,
      'la caja ve las opciones y no ve el producto interno de anticipos'
    )

    const [natural, adobado, carbon] = entero.options
    const venderPollo = (items: unknown[]): Promise<Response> =>
      asCajero('/api/ventas', 'POST', { items, paymentMethod: 'CASH', amountPaid: 1000 })
    assert(
      (await venderPollo([{ productId: entero.id, quantity: 1 }])).status === 400 &&
        (
          await venderPollo([
            { productId: entero.id, quantity: 1, optionIds: [natural.id, adobado.id] }
          ])
        ).status === 400 &&
        (
          await venderPollo([
            { productId: entero.id, quantity: 1, optionIds: [medio.options[0].id] }
          ])
        ).status === 400,
      'opciones: falta elegir, dos del mismo grupo u opción de otro producto -> 400'
    )
    assert(
      (
        await venderPollo([
          { productId: entero.id, quantity: 1, optionIds: [carbon.id], price: 191 }
        ])
      ).status === 400,
      'el precio con opciones tampoco puede subir del de catálogo (190)'
    )
    const ventaPolloRes = await venderPollo([
      { productId: entero.id, quantity: 2, optionIds: [carbon.id], note: '  bien   dorado ' },
      { productId: medio.id, quantity: 1, optionIds: [medio.options[0].id] }
    ])
    const ventaPollo = (await ventaPolloRes.json()) as CreateSaleResponse
    assert(
      ventaPollo.total === 475 &&
        ventaPollo.items[0].name === 'Pollo entero (Al carbón)' &&
        ventaPollo.items[0].price === 190 &&
        ventaPollo.items[0].note === 'bien dorado' &&
        ventaPollo.items[1].note === null,
      `venta con opciones (+$10 al carbón) y nota (${JSON.stringify(ventaPollo)})`
    )
    assert(
      (await itemDe(pollo.id))?.stock === 17.5,
      `paquetes descuentan su contenido: 20 − 2 − 0.5 = 17.5 (${(await itemDe(pollo.id))?.stock})`
    )

    // Quitar "Al carbón": las demás se conservan (mismos ids) y la quitada ya no se vende.
    const sinCarbon = (await (
      await asAdmin(`/api/productos/${entero.id}`, 'PUT', {
        name: entero.name,
        price: 180,
        categoryId: null,
        options: [
          { id: natural.id, groupName: 'Tipo de pollo', name: 'Natural', price: 0 },
          { id: adobado.id, groupName: 'Tipo de pollo', name: 'Adobado', price: 0 }
        ]
      })
    ).json()) as ProductWithCategory
    assert(
      sinCarbon.options.map((o) => o.id).join() === `${natural.id},${adobado.id}` &&
        sinCarbon.components.length === 1,
      `editar opciones conserva ids y no toca el contenido (${JSON.stringify(sinCarbon)})`
    )
    assert(
      (await venderPollo([{ productId: entero.id, quantity: 1, optionIds: [carbon.id] }]))
        .status === 400,
      'una opción quitada ya no se puede vender'
    )

    // Encargo con anticipo en efectivo.
    const lineaFamiliar = {
      productId: familiar.id,
      quantity: 1,
      optionIds: [familiar.options[1].id],
      note: 'sin cebolla'
    }
    const pickupAt = Math.floor(Date.now() / 1000) + 3 * 3600
    assert(
      (
        await asCajero('/api/encargos', 'POST', {
          customerName: 'Doña Rosa',
          pickupAt,
          items: [lineaFamiliar],
          deposit: 300,
          depositMethod: 'CASH',
          amountPaid: 300
        })
      ).status === 400,
      'anticipo mayor que el encargo -> 400'
    )
    assert(
      (
        await asCajero('/api/encargos', 'POST', {
          customerName: 'Doña Rosa',
          pickupAt: pickupAt - 86_400,
          items: [lineaFamiliar]
        })
      ).status === 400,
      'encargo para una hora que ya pasó -> 400'
    )
    const encargoRes = await asCajero('/api/encargos', 'POST', {
      customerName: '  Doña   Rosa ',
      phone: '555 123 4567',
      pickupAt,
      notes: 'Pasa su hijo',
      items: [lineaFamiliar],
      deposit: 100,
      depositMethod: 'CASH',
      amountPaid: 200,
      clientRequestId: 'encargo-rosa-1'
    })
    const encargo = (await encargoRes.json()) as CreateOrderResponse
    assert(
      encargoRes.status === 201 &&
        encargo.order.customerName === 'Doña Rosa' &&
        encargo.order.total === 260 &&
        encargo.order.deposit === 100 &&
        encargo.order.status === 'PENDING' &&
        encargo.order.items[0].name === 'Paquete familiar (Adobado)' &&
        encargo.order.items[0].note === 'sin cebolla' &&
        encargo.depositSale?.total === 100 &&
        encargo.depositSale.change === 100,
      `encargo con anticipo: venta de $100 con cambio de $100 (${JSON.stringify(encargo)})`
    )
    const encargoDup = await asCajero('/api/encargos', 'POST', {
      customerName: 'Doña Rosa',
      pickupAt,
      items: [lineaFamiliar],
      deposit: 100,
      depositMethod: 'CASH',
      amountPaid: 200,
      clientRequestId: 'encargo-rosa-1'
    })
    assert(
      encargoDup.status === 200 &&
        ((await encargoDup.json()) as CreateOrderResponse).order.id === encargo.order.id,
      'encargo repetido (doble clic) devuelve el mismo, sin cobrar dos veces'
    )
    assert(
      (await itemDe(pollo.id))?.stock === 17.5,
      'el encargo no descuenta inventario hasta que se entrega'
    )
    const anticipoId = encargo.depositSale!.items[0].productId
    assert(
      (await venderPollo([{ productId: anticipoId, quantity: 1, price: 50 }])).status === 400,
      'el producto de anticipos no se vende a mano'
    )
    const turnoAnticipo = ((await (await asCajero('/api/ventas/turno')).json()) as TurnSale[]).find(
      (t) => t.id === encargo.depositSale!.id
    )
    assert(turnoAnticipo?.itemCount === 0, 'el anticipo no cuenta como producto vendido')
    const pendientes = (await (await asCajero('/api/encargos')).json()) as Order[]
    assert(
      pendientes.length === 1 && pendientes[0].id === encargo.order.id,
      'lista de encargos pendientes'
    )

    // Entrega: se cobra lo que resta (260 − 100) y se descuenta el inventario.
    const entrega = (await (
      await asCajero('/api/ventas', 'POST', {
        items: [lineaFamiliar],
        paymentMethod: 'CASH',
        amountPaid: 200,
        orderId: encargo.order.id
      })
    ).json()) as CreateSaleResponse
    assert(
      entrega.total === 160 &&
        entrega.change === 40 &&
        entrega.items.some((i) => i.subtotal === -100),
      `entrega: cobra 160 y el anticipo va como renglón negativo (${JSON.stringify(entrega)})`
    )
    assert(
      (await itemDe(pollo.id))?.stock === 16.5 && (await itemDe(tortillas.id))?.stock === 49,
      'al entregar se descuenta el contenido del paquete'
    )
    const otraEntrega = await asCajero('/api/ventas', 'POST', {
      items: [lineaFamiliar],
      paymentMethod: 'CASH',
      amountPaid: 300,
      orderId: encargo.order.id
    })
    assert(
      otraEntrega.status === 409,
      `un encargo entregado no se cobra dos veces (${otraEntrega.status})`
    )
    const cerrados = (await (await asCajero('/api/encargos?status=CLOSED')).json()) as Order[]
    assert(
      cerrados[0]?.id === encargo.order.id &&
        cerrados[0].status === 'DELIVERED' &&
        cerrados[0].saleId === entrega.id,
      'el encargo queda entregado con su venta'
    )

    // Entregar llevando menos de lo que ya se pagó: no se puede (el total quedaría negativo).
    const chico = (await (
      await asCajero('/api/encargos', 'POST', {
        customerName: 'Pedro',
        pickupAt,
        items: [{ productId: medio.id, quantity: 2, optionIds: [medio.options[0].id] }],
        deposit: 150,
        depositMethod: 'TRANSFER'
      })
    ).json()) as CreateOrderResponse
    assert(
      (
        await asCajero('/api/ventas', 'POST', {
          items: [{ productId: medio.id, quantity: 1, optionIds: [medio.options[0].id] }],
          paymentMethod: 'CASH',
          amountPaid: 0,
          orderId: chico.order.id
        })
      ).status === 400,
      'entregar menos de lo anticipado -> 400'
    )

    // Cancelar devolviendo el anticipo: sale de la caja como retiro.
    const cancelado = (await (
      await asCajero(`/api/encargos/${chico.order.id}/cancelar`, 'POST', { refund: true })
    ).json()) as Order
    const movsEncargo = (await (await asCajero('/api/caja/movimientos')).json()) as CashMovement[]
    assert(
      cancelado.status === 'CANCELLED' &&
        movsEncargo.some(
          (m) => m.type === 'OUT' && m.amount === 150 && m.reason.includes(`#${chico.order.id}`)
        ),
      `cancelar con devolución registra el retiro de $150 (${JSON.stringify(movsEncargo)})`
    )
    assert(
      (await asCajero(`/api/encargos/${chico.order.id}/cancelar`, 'POST', {})).status === 409,
      'no se cancela dos veces'
    )
    const sinAnticipo = await asCajero('/api/encargos', 'POST', {
      customerName: 'Luis',
      pickupAt,
      items: [{ productId: entero.id, quantity: 1, optionIds: [natural.id] }]
    })
    assert(
      sinAnticipo.status === 201 &&
        ((await sinAnticipo.json()) as CreateOrderResponse).depositSale === null,
      'encargo sin anticipo: no hay venta todavía'
    )

    // Plantilla de pollería: sobre un catálogo que ya tiene "Pollo entero" (que aquí es paquete).
    const plantillaPolleria = (await (
      await asAdmin('/api/productos/plantillas/polleria', 'POST')
    ).json()) as TemplateResult
    const conPlantilla = (await (
      await asAdmin('/api/productos?all=1')
    ).json()) as ProductWithCategory[]
    const cuarto = conPlantilla.find((p) => p.name === 'Cuarto de pollo')
    const envio = conPlantilla.find((p) => p.name === 'Envío a domicilio')
    assert(
      plantillaPolleria.existing.includes('Pollo entero') &&
        plantillaPolleria.created.includes('Tortillas 1/2 kg') &&
        plantillaPolleria.failed.some((f) => f.name === 'Cuarto de pollo') &&
        cuarto === undefined &&
        envio?.openPrice === 1 &&
        envio.categoryName === 'Servicio',
      `plantilla: respeta lo existente y reporta lo que choca (${JSON.stringify(plantillaPolleria)})`
    )
    const otraVez = (await (
      await asAdmin('/api/productos/plantillas/polleria', 'POST')
    ).json()) as TemplateResult
    assert(otraVez.created.length === 0, 'aplicar la plantilla dos veces no duplica')
    assert(
      (await asCajero('/api/productos/plantillas/polleria', 'POST')).status === 403 &&
        (await asAdmin('/api/productos/plantillas/ferreteria', 'POST')).status === 404,
      'plantilla: sólo admin y sólo las que existen'
    )

    console.log(
      `\n✅ Backend verificado (${PG ? 'PostgreSQL' : 'SQLite'}) — Sprints 0–8 + cuentas por cobrar OK`
    )
  } finally {
    if (server) await server.close()
    await closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('\n❌ Verificación fallida\n', err)
  // Salir ya: una impresora falsa que quedó abierta dejaría el proceso (y el CI) colgado.
  process.exit(1)
})
