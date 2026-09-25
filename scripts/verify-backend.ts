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
import { getStore, initStore } from '../src/main/lib/store'
import { startServer } from '../src/main/server'
import { getHardwareFingerprint, publicKeyOf, signLicense } from '../src/main/services/license'
import type {
  BackupRunResponse,
  BackupStatus,
  FolderListing,
  SystemPrintersResponse,
  CashMovement,
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
  LicenseStatusResponse,
  LoginResponse,
  PingResponse,
  ProductWithCategory,
  SalesPage,
  SalesReport,
  SaleWithItems,
  UserListItem
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

    const prods = (await (await asCajero('/api/productos')).json()) as ProductWithCategory[]
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
      reporte.topProducts.some((p) => p.name === 'Producto de prueba' && p.quantity >= 3),
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
      printed.printed && bytes.includes('PRUEBA DE IMPRESION'),
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
    assert(
      reprintOk.status === 200 &&
        Buffer.concat(received).toString('latin1').includes(`Ticket #${sale1.ticketNumber}`),
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
  process.exitCode = 1
})
