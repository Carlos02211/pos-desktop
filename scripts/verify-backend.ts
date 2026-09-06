/**
 * Verificación de backend sin GUI (Sprints 0–3).
 *
 * Reproduce lo que hace el Main Process al arrancar, pero fuera de Electron:
 *   1. Store cifrado + SQLite en un directorio temporal, con migraciones y seed.
 *   2. Levanta Fastify + Socket.io en :3001.
 *   3. Sprint 0 — GET /api/ping (Renderer -> Fastify -> SQLite) + validación Zod.
 *   4. Sprint 1 — licencia por hardware + auth (login, JWT en /api/auth/me, roles).
 *   5. Sprint 2 — catálogo, apertura de caja y registro de ventas (folio, cambio, snapshot).
 *   6. Sprint 3 — resumen de turno, cierre de caja (esperado/diferencia) + respaldo, reimpresión.
 *
 * Uso:  pnpm verify:backend
 */
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { count, eq } from 'drizzle-orm'
import { closeDb, initDb } from '../src/main/db'
import { users } from '../src/main/db/schema'
import { runSeed } from '../src/main/db/seed'
import { initStore } from '../src/main/lib/store'
import { startServer } from '../src/main/server'
import { expectedKeyForFingerprint, getHardwareFingerprint } from '../src/main/services/license'
import type {
  CashSession,
  CashSessionSummary,
  Category,
  CreateSaleResponse,
  LicenseStatusResponse,
  LoginResponse,
  PingResponse,
  ProductWithCategory,
  SaleWithItems
} from '../src/shared/types'

const MIGRATIONS = join(process.cwd(), 'resources', 'migrations')
const PORT = 3001

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
    initStore(dir)
    const db = initDb(dbPath, MIGRATIONS)
    await runSeed(db)

    // ---- Sprint 0: seed ----
    const [{ n: userCount }] = db.select({ n: count() }).from(users).all()
    assert(userCount === 2, `seed: 2 usuarios (admin + cajero) — encontrados: ${userCount}`)
    const admin = db.select().from(users).where(eq(users.username, 'admin')).get()
    assert(admin?.role === 'ADMIN', 'seed: "admin" con rol ADMIN')
    assert(admin!.password.startsWith('$2'), 'seed: contraseña como hash bcrypt')

    await runSeed(db)
    const [{ n: userCount2 }] = db.select({ n: count() }).from(users).all()
    assert(userCount2 === 2, 'seed idempotente: no duplica en la 2ª ejecución')

    server = await startServer({ port: PORT, version: '0.1.0', isDev: false, dbPath, backupDir })
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
    const validKey = expectedKeyForFingerprint(fingerprint)
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
      sale2.print.printed === false && sale2.print.error === 'Impresora no configurada',
      'venta: sin impresora configurada, print.printed=false y la venta igual se registra'
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

    const reimpr = await asAdmin(`/api/ventas/${sale1.id}/reimprimir`, 'POST')
    assert(reimpr.status === 502, `reimprimir sin impresora -> 502 (status: ${reimpr.status})`)

    const cierre = await asCajero('/api/caja/cierre', 'POST', { closingAmount: 540 })
    assert(cierre.status === 200, `cierre de caja -> 200 (status: ${cierre.status})`)
    const cierreBody = (await cierre.json()) as {
      session: CashSession
      backup: { ok: boolean; path?: string }
    }
    assert(cierreBody.session.status === 'CLOSED', 'cierre: sesión queda CLOSED')
    assert(cierreBody.session.expectedAmount === 550, 'cierre: efectivo esperado 550')
    assert(cierreBody.session.difference === -10, 'cierre: diferencia -10 (faltante)')
    assert(
      cierreBody.backup.ok && !!cierreBody.backup.path && existsSync(cierreBody.backup.path),
      'cierre: respaldo de la BD creado en disco'
    )

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

    console.log('\n✅ Backend verificado — Sprints 0–3 OK')
  } finally {
    if (server) await server.close()
    closeDb()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('\n❌ Verificación fallida\n', err)
  process.exitCode = 1
})
