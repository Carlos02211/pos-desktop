/**
 * Verificación multicaja (Fase 2) contra un PostgreSQL REAL.
 *
 * `verify:backend:pg` corre sobre PGlite, que tiene una sola conexión: ahí nunca hay dos
 * transacciones a la vez y las carreras no se pueden ver. Este script levanta el servidor
 * contra un PostgreSQL de verdad (pool de conexiones) y dispara en paralelo lo que hacen
 * varias cajas al mismo tiempo: ventas, aperturas, abonos, cierres y altas de productos.
 *
 * Crea una base temporal `pos_multicaja_<ts>` a partir de DATABASE_URL (que debe apuntar a
 * un PostgreSQL con permiso de CREATE DATABASE) y la borra al terminar: nunca toca datos
 * existentes.
 *
 * Uso:
 *   docker run -d --name pos-pgtest -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos \
 *     -e POSTGRES_DB=pos -p 127.0.0.1:55432:5432 postgres:16-alpine
 *   DATABASE_URL=postgres://pos:pos@127.0.0.1:55432/pos pnpm verify:multicaja
 */
import crypto from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import pg from 'pg'
import { io, type Socket } from 'socket.io-client'
import type {
  CashSession,
  CreateSaleResponse,
  CreditAccountDetail,
  LoginResponse,
  ProductWithCategory
} from '../src/shared/types'

const CAJAS = 3
const VENTAS_POR_CAJA = 20

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`)
  console.log(`✓ ${msg}`)
}

function tally(statuses: number[]): string {
  const counts = new Map<number, number>()
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1)
  return [...counts].map(([s, n]) => `${n}×${s}`).join(', ')
}

async function main(): Promise<void> {
  const baseUrl = process.env.DATABASE_URL
  if (!baseUrl || !/^postgres(ql)?:\/\//.test(baseUrl)) {
    throw new Error('DATABASE_URL debe apuntar a un PostgreSQL real (postgres://…), no a PGlite.')
  }

  // Base temporal: se crea ANTES de importar el código del servidor, que lee DATABASE_URL
  // al cargar el módulo.
  const dbName = `pos_multicaja_${Date.now()}`
  const admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${dbName}`)
  const url = new URL(baseUrl)
  url.pathname = `/${dbName}`
  process.env.DATABASE_URL = url.toString()

  const { privateKey: testLicenseKey } = crypto.generateKeyPairSync('ed25519')
  const { publicKeyOf, signLicense, getHardwareFingerprint } =
    await import('../src/main/services/license')
  process.env.POS_LICENSE_PUBLIC_KEY = publicKeyOf(testLicenseKey)

  const { closeDb, initDb } = await import('../src/main/db')
  const { runSeed } = await import('../src/main/db/seed')
  const { initStore } = await import('../src/main/lib/store')
  const { startServer } = await import('../src/main/server')
  const { sql } = await import('drizzle-orm')

  const dir = mkdtempSync(join(tmpdir(), 'pos-multicaja-'))
  let server: Awaited<ReturnType<typeof startServer>> | null = null
  const sockets: Socket[] = []

  try {
    await initStore(dir, 'file')
    const db = await initDb(
      join(dir, 'unused.db'),
      join(process.cwd(), 'resources', 'migrations-pg')
    )
    await runSeed(db)
    const q = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
      (await (db as unknown as { execute: (q: unknown) => Promise<{ rows: T[] }> }).execute(query))
        .rows

    server = await startServer({
      port: Number(process.env.VERIFY_PORT) || 3002,
      version: '0.1.0',
      isDev: false,
      dbPath: join(dir, 'unused.db'),
      backupDir: join(dir, 'backups'),
      uploadsDir: join(dir, 'uploads')
    })
    const base = server.url
    assert(true, `servidor en ${base} contra PostgreSQL real (base temporal ${dbName})`)

    const json = { 'content-type': 'application/json' }
    const activated = await fetch(`${base}/api/licencia/activar`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ key: signLicense(await getHardwareFingerprint(), testLicenseKey) })
    })
    assert(activated.ok, 'licencia activada')

    const login = async (username: string, password: string): Promise<LoginResponse> => {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ username, password })
      })
      if (!res.ok) throw new Error(`login ${username} -> ${res.status}`)
      return (await res.json()) as LoginResponse
    }
    const call =
      (token: string) =>
      (path: string, method = 'GET', body?: unknown): Promise<Response> =>
        fetch(`${base}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : json) },
          body: body === undefined ? undefined : JSON.stringify(body)
        })

    const adminSession = await login('admin', 'admin123')
    const asAdmin = call(adminSession.token)

    // ---- Preparación: cobradores, productos y un cliente ----
    const cajas: { name: string; call: ReturnType<typeof call>; userId: number }[] = []
    for (let i = 1; i <= CAJAS; i++) {
      const name = `caja${i}`
      const created = await asAdmin('/api/usuarios', 'POST', {
        username: name,
        password: 'secreto123',
        role: 'COBRADOR'
      })
      if (!created.ok) throw new Error(`crear ${name} -> ${created.status}`)
      const s = await login(name, 'secreto123')
      cajas.push({ name, call: call(s.token), userId: s.user.id })
    }
    assert(cajas.length === CAJAS, `${CAJAS} cobradores con sesión propia`)

    const newProduct = async (body: object): Promise<ProductWithCategory> => {
      const res = await asAdmin('/api/productos', 'POST', { categoryId: null, ...body })
      if (res.status !== 201) throw new Error(`crear producto -> ${res.status}`)
      return (await res.json()) as ProductWithCategory
    }
    const refresco = await newProduct({ name: 'Refresco', price: 18.5, barcode: '7501055300075' })
    const queso = await newProduct({ name: 'Queso', price: 180, unit: 'KG' })
    const cliente = await (
      await cajas[0].call('/api/clientes', 'POST', { name: 'Doña Mary' })
    ).json()

    // ---- Socket.io: el dashboard del admin ve las ventas de todas las cajas ----
    let ventasVistas = 0
    const dash = io(base, { transports: ['websocket'], auth: { token: adminSession.token } })
    sockets.push(dash)
    dash.on('venta:nueva', () => ventasVistas++)
    await new Promise<void>((resolve, reject) => {
      dash.once('connect', () => resolve())
      dash.once('connect_error', reject)
    })
    assert(dash.connected, 'socket del dashboard conectado con JWT')

    // ---- 1. Doble apertura simultánea de la misma caja ----
    const aperturas = await Promise.all(
      Array.from({ length: 5 }, () =>
        cajas[0].call('/api/caja/apertura', 'POST', { openingAmount: 500 })
      )
    )
    const okAperturas = aperturas.filter((r) => r.ok).length
    assert(
      okAperturas === 1 && aperturas.filter((r) => r.status === 409).length === 4,
      `5 aperturas simultáneas de caja1 -> 1 abierta, 4×409 (${tally(aperturas.map((r) => r.status))})`
    )
    const [{ n: abiertas }] = await q<{ n: number }>(
      sql`select count(*)::int as n from cash_sessions where user_id = ${cajas[0].userId} and status = 'OPEN'`
    )
    assert(abiertas === 1, `caja1 tiene exactamente 1 sesión abierta en la BD (${abiertas})`)
    for (const c of cajas.slice(1)) {
      const r = await c.call('/api/caja/apertura', 'POST', { openingAmount: 500 })
      if (!r.ok) throw new Error(`apertura ${c.name} -> ${r.status}`)
    }

    // ---- 2. Todas las cajas venden a la vez ----
    const sale = (c: (typeof cajas)[number], i: number): Promise<Response> =>
      c.call('/api/ventas', 'POST', {
        items:
          i % 3 === 0
            ? [{ productId: queso.id, quantity: 0.25 }]
            : [{ productId: refresco.id, quantity: 1 + (i % 2) }],
        paymentMethod: i % 4 === 0 ? 'CARD' : 'CASH',
        amountPaid: 1000
      })
    const t0 = Date.now()
    const ventas = await Promise.all(
      cajas.flatMap((c) => Array.from({ length: VENTAS_POR_CAJA }, (_, i) => sale(c, i)))
    )
    const ms = Date.now() - t0
    assert(
      ventas.every((r) => r.status === 201),
      `${ventas.length} ventas simultáneas de ${CAJAS} cajas -> todas 201 en ${ms} ms (${tally(ventas.map((r) => r.status))})`
    )
    const folios = await q<{ user_id: number; folios: number[] }>(sql`
      select s.user_id, array_agg(v.ticket_number order by v.ticket_number) as folios
      from sales v join cash_sessions s on s.id = v.cash_session_id
      where s.status = 'OPEN' group by s.user_id`)
    const esperado = Array.from({ length: VENTAS_POR_CAJA }, (_, i) => i + 1).join(',')
    assert(
      folios.length === CAJAS && folios.every((f) => f.folios.join(',') === esperado),
      `folios de cada caja: 1..${VENTAS_POR_CAJA} sin huecos ni repetidos`
    )
    // Hasta 3 s: en un runner de CI lento los eventos del socket llegan tarde.
    for (let i = 0; i < 30 && ventasVistas < ventas.length; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    assert(
      ventasVistas === ventas.length,
      `dashboard recibió ${ventasVistas}/${ventas.length} eventos venta:nueva`
    )

    // ---- 3. Doble envío de la misma venta (doble clic / reintento de red) ----
    const [{ n: antes }] = await q<{ n: number }>(sql`select count(*)::int as n from sales`)
    const clientRequestId = crypto.randomUUID()
    const dobles = await Promise.all(
      Array.from({ length: 5 }, () =>
        cajas[1].call('/api/ventas', 'POST', {
          items: [{ productId: refresco.id, quantity: 1 }],
          paymentMethod: 'CASH',
          amountPaid: 20,
          clientRequestId
        })
      )
    )
    const [{ n: despues }] = await q<{ n: number }>(sql`select count(*)::int as n from sales`)
    const folioDobles = new Set(
      await Promise.all(
        dobles.map(async (r) => ((await r.json()) as CreateSaleResponse).ticketNumber)
      )
    )
    assert(
      despues - antes === 1 && folioDobles.size === 1,
      `5 envíos simultáneos con el mismo clientRequestId -> 1 venta (se crearon ${despues - antes}; ${tally(dobles.map((r) => r.status))})`
    )

    // ---- 4. Abonos simultáneos a la misma cuenta desde 3 cajas ----
    const fiado = await cajas[0].call('/api/ventas', 'POST', {
      items: [
        { productId: refresco.id, quantity: 1 },
        { productId: queso.id, quantity: 0.45 }
      ],
      paymentMethod: 'CREDIT',
      customerId: cliente.id,
      amountPaid: 0
    })
    const fiadoBody = (await fiado.json()) as CreateSaleResponse
    assert(fiado.status === 201 && !!fiadoBody.creditAccountId, 'venta fiada de $99.50')
    const cuentaId = fiadoBody.creditAccountId!
    const abonos = await Promise.all(
      cajas.map((c) =>
        c.call(`/api/cuentas/${cuentaId}/abono`, 'POST', { amount: 40, paymentMethod: 'CASH' })
      )
    )
    const aceptados = abonos.filter((r) => r.ok).length
    const cuenta = (await (await asAdmin(`/api/cuentas/${cuentaId}`)).json()) as CreditAccountDetail
    assert(
      aceptados === 2 && cuenta.paid === 80,
      `3 abonos de $40 simultáneos a una deuda de $99.50 -> 2 aceptados, pagado $80 (aceptados ${aceptados}, pagado ${cuenta.paid})`
    )
    const liquidar = await Promise.all(
      cajas.map((c) =>
        c.call(`/api/cuentas/${cuentaId}/abono`, 'POST', { amount: 19.5, paymentMethod: 'CASH' })
      )
    )
    const cuentaFinal = (await (
      await asAdmin(`/api/cuentas/${cuentaId}`)
    ).json()) as CreditAccountDetail
    assert(
      liquidar.filter((r) => r.ok).length === 1 &&
        cuentaFinal.status === 'PAID' &&
        cuentaFinal.paid === cuentaFinal.total,
      `3 cajas liquidan a la vez -> 1 liquida, la cuenta queda PAID sin sobrepago (${tally(liquidar.map((r) => r.status))})`
    )

    // ---- 5. Ventas en el mismo instante del cierre de caja ----
    const c3 = cajas[2]
    const sesion3 = (await (await c3.call('/api/caja/sesion-activa')).json()) as CashSession
    const carrera = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => sale(c3, i + 1)),
      c3.call('/api/caja/cierre', 'POST', { closingAmount: 0 }),
      ...Array.from({ length: 10 }, (_, i) => sale(c3, i + 1))
    ])
    const cierre = carrera[10]
    assert(cierre.ok, `cierre de caja3 en medio de 20 ventas -> ${cierre.status}`)
    const corte = (await cierre.json()) as { summary: { salesCount: number } }
    const [{ n: enSesion }] = await q<{ n: number }>(
      sql`select count(*)::int as n from sales where cash_session_id = ${sesion3.id}`
    )
    assert(
      enSesion === corte.summary.salesCount,
      `ninguna venta se cuela en la caja ya cerrada: corte cuenta ${corte.summary.salesCount}, la BD tiene ${enSesion}`
    )
    const tarde = carrera.filter((r, i) => i !== 10 && r.status === 409).length
    const creadas = carrera.filter((r, i) => i !== 10 && r.status === 201).length
    assert(
      creadas + tarde === 20,
      `las ventas que llegan tras el cierre se rechazan con 409 (${creadas} vendidas, ${tarde}×409)`
    )

    // ---- 6. Los cortes cuadran con lo que hay en la BD ----
    for (const c of cajas.slice(0, 2)) {
      const res = await c.call('/api/caja/cierre', 'POST', { closingAmount: 0 })
      const body = (await res.json()) as { session: { id: number; expectedAmount: number } }
      const [{ esperado: enBd }] = await q<{ esperado: number }>(sql`
        select s.opening_amount
          + coalesce((select sum(total) from sales v where v.cash_session_id = s.id and v.payment_method = 'CASH'), 0)
          + coalesce((select sum(amount_paid) from sales v where v.cash_session_id = s.id and v.payment_method = 'CREDIT'), 0)
          + coalesce((select sum(amount) from credit_payments p where p.cash_session_id = s.id and p.payment_method = 'CASH'), 0)
          + coalesce((select sum(case when m.type = 'IN' then m.amount else -m.amount end) from cash_movements m where m.cash_session_id = s.id), 0)
          as esperado
        from cash_sessions s where s.id = ${body.session.id}`)
      assert(
        Math.round(body.session.expectedAmount * 100) === Number(enBd),
        `corte de ${c.name}: efectivo esperado $${body.session.expectedAmount} = apertura + ventas + abonos en efectivo de la BD`
      )
    }

    // ---- 7. Dos admins dan de alta el mismo código de barras a la vez ----
    const altas = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        asAdmin('/api/productos', 'POST', {
          name: `Galletas ${i}`,
          price: 15,
          categoryId: null,
          barcode: '7501000111206'
        })
      )
    )
    assert(
      altas.filter((r) => r.status === 201).length === 1 &&
        altas.filter((r) => r.status === 409).length === 4,
      `5 altas simultáneas con el mismo código -> 1×201, 4×409 (${tally(altas.map((r) => r.status))})`
    )

    console.log(`\n✅ Multicaja verificado contra PostgreSQL real (${CAJAS} cajas en paralelo)`)
  } finally {
    for (const s of sockets) s.close()
    if (server) await server.close()
    await closeDb()
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {})
    await admin.end()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('\n❌ Verificación multicaja fallida\n', err)
  process.exitCode = 1
})
