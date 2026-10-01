/**
 * QA de estrés contra un PostgreSQL REAL (pool de conexiones, carreras de verdad).
 *
 * Complementa a `verify:multicaja` con lo que agregaron pollería y mesas, y con revisiones
 * que no dependen de una función en particular:
 *   1. Permisos: TODAS las rutas de la API sin sesión, como cobrador y como admin. Ninguna
 *      responde 500; sin sesión sólo pasan las públicas; el cobrador no entra a las de admin.
 *   2. Datos basura en cada POST/PUT: nunca 500.
 *   3. Ventas simultáneas de varias cajas con opciones y paquetes: inventario, folios y totales
 *      cuadran con la BD.
 *   4. Mesas: muchas cajas agregando a la misma cuenta, dos cobrándola a la vez, nombres
 *      repetidos al mismo tiempo.
 *   5. Encargos: doble envío, entregar dos veces a la vez, entregar contra cancelar.
 *   6. Cortes: el efectivo esperado de cada caja = lo que dice la BD.
 *
 * Crea una base temporal `pos_estres_<ts>` y la borra al terminar.
 *
 * Uso:
 *   docker run -d --rm --name pos-qa-pg -e POSTGRES_PASSWORD=qa -p 127.0.0.1:55432:5432 \
 *     postgres:16-alpine
 *   DATABASE_URL=postgres://postgres:qa@127.0.0.1:55432/postgres pnpm verify:estres
 */
import crypto from 'crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import pg from 'pg'
import type {
  CreateOrderResponse,
  LoginResponse,
  Order,
  ProductWithCategory,
  TabResponse
} from '../src/shared/types'

const CAJAS = 4
const VENTAS_POR_CAJA = 50

const problems: string[] = []
function check(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`)
  else {
    console.log(`✗ ${msg}`)
    problems.push(msg)
  }
}

function tally(statuses: number[]): string {
  const counts = new Map<number, number>()
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => a[0] - b[0])
    .map(([s, n]) => `${n}×${s}`)
    .join(', ')
}

/** Rutas declaradas en src/main/routes (método + ruta), leídas del código. */
function declaredRoutes(): { method: string; path: string }[] {
  const dir = join(process.cwd(), 'src', 'main', 'routes')
  const out: { method: string; path: string }[] = []
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), 'utf8')
    for (const m of text.matchAll(/app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g)) {
      out.push({ method: m[1].toUpperCase(), path: m[2] })
    }
  }
  return out
}

/** Rutas que se pueden usar sin sesión (a propósito). */
const PUBLIC = new Set([
  'GET /api/ping',
  'GET /api/licencia/estado',
  'POST /api/licencia/activar',
  'POST /api/auth/login',
  'GET /api/config/branding',
  'GET /api/auth/usuarios-login',
  // Pantalla de login / app instalable: nombre y logo del negocio. Cerrar sesión no requiere una.
  'GET /api/marca',
  'GET /manifest.webmanifest',
  'POST /api/auth/logout'
])

async function main(): Promise<void> {
  const baseUrl = process.env.DATABASE_URL
  if (!baseUrl || !/^postgres(ql)?:\/\//.test(baseUrl)) {
    throw new Error('DATABASE_URL debe apuntar a un PostgreSQL real (postgres://…).')
  }
  const dbName = `pos_estres_${Date.now()}`
  const pgAdmin = new pg.Client({ connectionString: baseUrl })
  await pgAdmin.connect()
  await pgAdmin.query(`CREATE DATABASE ${dbName}`)
  const url = new URL(baseUrl)
  url.pathname = `/${dbName}`
  process.env.DATABASE_URL = url.toString()

  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  const { publicKeyOf, signLicense, getHardwareFingerprint } =
    await import('../src/main/services/license')
  process.env.POS_LICENSE_PUBLIC_KEY = publicKeyOf(privateKey)
  const { closeDb, initDb } = await import('../src/main/db')
  const { runSeed } = await import('../src/main/db/seed')
  const { initStore } = await import('../src/main/lib/store')
  const { startServer } = await import('../src/main/server')
  const { sql } = await import('drizzle-orm')

  const dir = mkdtempSync(join(tmpdir(), 'pos-estres-'))
  let server: Awaited<ReturnType<typeof startServer>> | null = null
  try {
    await initStore(dir, 'file')
    const db = await initDb(join(dir, 'x.db'), join(process.cwd(), 'resources', 'migrations-pg'))
    await runSeed(db)
    const q = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
      (await (db as unknown as { execute: (q: unknown) => Promise<{ rows: T[] }> }).execute(query))
        .rows
    server = await startServer({
      port: Number(process.env.VERIFY_PORT) || 3003,
      version: '0.1.0',
      isDev: false,
      dbPath: join(dir, 'x.db'),
      backupDir: join(dir, 'backups'),
      uploadsDir: join(dir, 'uploads')
    })
    const base = server.url
    const json = { 'content-type': 'application/json' }
    await fetch(`${base}/api/licencia/activar`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ key: signLicense(await getHardwareFingerprint(), privateKey) })
    })
    const login = async (username: string, password: string): Promise<LoginResponse> => {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ username, password })
      })
      if (!res.ok) throw new Error(`login ${username} -> ${res.status}`)
      return (await res.json()) as LoginResponse
    }
    const raw =
      (token: string | null) =>
      (path: string, method = 'GET', body?: unknown) =>
        fetch(`${base}${path}`, {
          method,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body === undefined ? {} : json)
          },
          body:
            body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
        })
    const asAdmin = raw((await login('admin', 'admin123')).token)
    const asCajero = raw((await login('cajero', 'cajero123')).token)
    const anon = raw(null)

    // ================= 1. Permisos por rol =================
    const routes = declaredRoutes()
    const fill = (p: string): string =>
      p.replace(':codigo', '7501055363803').replace(':id', '999999').replace(/:\w+/g, '1')
    const anonLeaks: string[] = []
    const cajeroAdmin: string[] = []
    const crashes: string[] = []
    for (const r of routes) {
      const path = fill(r.path)
      const key = `${r.method} ${r.path}`
      const body = r.method === 'GET' || r.method === 'DELETE' ? undefined : {}
      // Estas cambian el estado global de la prueba: se revisan aparte.
      if (/licencia\/activar|auth\/login|respaldos$|restaurar|cierre/.test(r.path)) continue
      const a = await anon(path, r.method, body)
      if (a.status >= 500) crashes.push(`${key} sin sesión -> ${a.status}`)
      if (a.status < 400 && !PUBLIC.has(key)) anonLeaks.push(`${key} -> ${a.status}`)
      const c = await asCajero(path, r.method, body)
      if (c.status >= 500) crashes.push(`${key} cajero -> ${c.status} ${await c.text()}`)
      if (c.status !== 401 && c.status !== 403) {
        // ¿Es de admin según el código? Se busca el requireRole de esa ruta.
        cajeroAdmin.push(`${key} -> ${c.status}`)
      }
      const ad = await asAdmin(path, r.method, body)
      if (ad.status >= 500) crashes.push(`${key} admin -> ${ad.status} ${await ad.text()}`)
    }
    check(
      anonLeaks.length === 0,
      `sin sesión sólo pasan las rutas públicas (${anonLeaks.join('; ') || 'ok'})`
    )
    check(
      crashes.length === 0,
      `${routes.length} rutas × 3 roles sin 500 (${crashes.join(' | ') || 'ok'})`
    )
    console.log(
      `  · rutas que el cobrador sí puede usar (revisar a mano):\n    ${cajeroAdmin.join('\n    ')}`
    )

    // ================= 2. Datos basura =================
    const garbage: unknown[] = [
      'no-es-json',
      null,
      [],
      { items: 'x' },
      { items: [{ productId: 'a', quantity: -1 }] },
      { items: [{ productId: 1, quantity: 1e308 }], paymentMethod: 'CASH', amountPaid: 1e308 },
      { items: [{ productId: 2147483648, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 1 },
      { items: [{ productId: 1, quantity: 1, optionIds: [2147483648] }], paymentMethod: 'CARD' },
      { name: 'x'.repeat(10_000), price: -5 },
      { customerName: '', pickupAt: -1, items: [] },
      { items: [{ productId: 1, quantity: 1, note: 'x'.repeat(5000) }], paymentMethod: 'CARD' }
    ]
    const fuzzCrashes: string[] = []
    for (const r of routes.filter((x) => x.method === 'POST' || x.method === 'PUT')) {
      if (/licencia\/activar|restaurar|respaldos$/.test(r.path)) continue
      for (const body of garbage) {
        const res = await asAdmin(fill(r.path), r.method, body)
        if (res.status >= 500) {
          fuzzCrashes.push(
            `${r.method} ${r.path} ${JSON.stringify(body)?.slice(0, 60)} -> ${res.status}`
          )
        }
      }
    }
    check(
      fuzzCrashes.length === 0,
      `datos basura en cada POST/PUT sin 500 (${fuzzCrashes.join(' | ') || 'ok'})`
    )

    // ================= Preparación =================
    const alta = async (body: Record<string, unknown>): Promise<ProductWithCategory> => {
      const res = await asAdmin('/api/productos', 'POST', { categoryId: null, ...body })
      if (res.status !== 201)
        throw new Error(`alta ${String(body.name)} -> ${res.status} ${await res.text()}`)
      return (await res.json()) as ProductWithCategory
    }
    const tipos = [
      { groupName: 'Tipo', name: 'Natural', price: 0 },
      { groupName: 'Tipo', name: 'Al carbón', price: 10 }
    ]
    const pollo = await alta({
      name: 'Pollo entero',
      price: 180,
      options: tipos,
      trackStock: true,
      initialStock: 5000
    })
    const medio = await alta({
      name: 'Medio pollo',
      price: 95,
      options: tipos,
      components: [{ componentId: pollo.id, quantity: 0.5 }]
    })
    const refresco = await alta({
      name: 'Refresco',
      price: 22,
      trackStock: true,
      initialStock: 5000
    })
    const paquete = await alta({
      name: 'Paquete',
      price: 230,
      options: tipos,
      components: [
        { componentId: pollo.id, quantity: 1 },
        { componentId: refresco.id, quantity: 1 }
      ]
    })

    const cajas: { name: string; call: ReturnType<typeof raw> }[] = []
    for (let i = 1; i <= CAJAS; i++) {
      const name = `caja${i}`
      await asAdmin('/api/usuarios', 'POST', {
        username: name,
        password: 'secreto123',
        role: 'COBRADOR'
      })
      const c = raw((await login(name, 'secreto123')).token)
      const open = await c('/api/caja/apertura', 'POST', { openingAmount: 500 })
      if (open.status !== 201) throw new Error(`apertura ${name} -> ${open.status}`)
      cajas.push({ name, call: c })
    }

    // ================= 3. Ventas simultáneas con opciones y paquetes =================
    const natural = (p: ProductWithCategory): number => p.options[0].id
    const carbon = (p: ProductWithCategory): number => p.options[1].id
    let expectedPollo = 0
    let expectedRefresco = 0
    let expectedTotal = 0
    const sales: Promise<Response>[] = []
    for (const caja of cajas) {
      for (let i = 0; i < VENTAS_POR_CAJA; i++) {
        const kind = i % 3
        const items =
          kind === 0
            ? [{ productId: pollo.id, quantity: 2, optionIds: [carbon(pollo)], note: 'dorado' }]
            : kind === 1
              ? [
                  { productId: medio.id, quantity: 3, optionIds: [natural(medio)] },
                  { productId: refresco.id, quantity: 1 }
                ]
              : [{ productId: paquete.id, quantity: 1, optionIds: [carbon(paquete)] }]
        if (kind === 0) {
          expectedPollo += 2
          expectedTotal += 380
        } else if (kind === 1) {
          expectedPollo += 1.5
          expectedRefresco += 1
          expectedTotal += 285 + 22
        } else {
          expectedPollo += 1
          expectedRefresco += 1
          expectedTotal += 240
        }
        sales.push(caja.call('/api/ventas', 'POST', { items, paymentMethod: 'CARD' }))
      }
    }
    const t0 = Date.now()
    const saleRes = await Promise.all(sales)
    const ms = Date.now() - t0
    check(
      saleRes.every((r) => r.status === 201),
      `${sales.length} ventas simultáneas de ${CAJAS} cajas (${tally(saleRes.map((r) => r.status))}) en ${ms} ms`
    )
    const [stocks] = await q<{ pollo: number; refresco: number }>(
      sql`select (select stock from products where id = ${pollo.id}) as pollo, (select stock from products where id = ${refresco.id}) as refresco`
    )
    check(
      Number(stocks.pollo) === 5000 - expectedPollo &&
        Number(stocks.refresco) === 5000 - expectedRefresco,
      `inventario exacto tras la carrera: pollo ${stocks.pollo} (esperado ${5000 - expectedPollo}), refresco ${stocks.refresco} (esperado ${5000 - expectedRefresco})`
    )
    const [movs] = await q<{ total: number; last: number }>(
      sql`select coalesce(sum(quantity), 0) as total, (select stock_after from stock_movements where product_id = ${pollo.id} order by id desc limit 1) as last from stock_movements where product_id = ${pollo.id}`
    )
    check(
      // La suma incluye la entrada inicial (5000): debe dar la existencia actual.
      Number(movs.total) === Number(stocks.pollo) && Number(movs.last) === Number(stocks.pollo),
      `historial de inventario cuadra con la existencia (${movs.total}, último ${movs.last})`
    )
    const [sums] = await q<{ total: number; dup: number }>(
      sql`select coalesce(sum(total), 0) as total, (select count(*) from (select cash_session_id, ticket_number from sales group by 1, 2 having count(*) > 1) d) as dup from sales where payment_method = 'CARD'`
    )
    check(
      Number(sums.total) === expectedTotal * 100 && Number(sums.dup) === 0,
      `total vendido $${Number(sums.total) / 100} = $${expectedTotal} y sin folios repetidos`
    )

    // ================= 4. Mesas =================
    const mismoNombre = await Promise.all(
      cajas.map((c) => c.call('/api/cuentas-abiertas', 'POST', { name: 'Mesa 1', items: [] }))
    )
    check(
      mismoNombre.filter((r) => r.status === 201).length === 1,
      `${CAJAS} cajas abren "Mesa 1" a la vez -> una sola cuenta (${tally(mismoNombre.map((r) => r.status))})`
    )
    const [{ n: mesas1 }] = await q<{ n: number }>(
      sql`select count(*)::int as n from orders where type = 'CUENTA' and status = 'PENDING' and lower(customer_name) = 'mesa 1'`
    )
    check(Number(mesas1) === 1, `en la BD hay ${mesas1} cuenta(s) abierta(s) "Mesa 1"`)

    const mesa = (
      (await (
        await cajas[0].call('/api/cuentas-abiertas', 'POST', { name: 'Mesa 2', items: [] })
      ).json()) as TabResponse
    ).order
    const adds = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        cajas[i % CAJAS].call(`/api/cuentas-abiertas/${mesa.id}/agregar`, 'POST', {
          items: [
            { productId: refresco.id, quantity: 1 },
            ...(i % 4 === 0
              ? [{ productId: pollo.id, quantity: 1, optionIds: [natural(pollo)] }]
              : [])
          ]
        })
      )
    )
    const mesaFinal = ((await (await asAdmin('/api/cuentas-abiertas')).json()) as Order[]).find(
      (o) => o.id === mesa.id
    )!
    const refQty = mesaFinal.items.find((i) => i.productId === refresco.id)?.quantity
    const polloQty = mesaFinal.items.find((i) => i.productId === pollo.id)?.quantity
    check(
      adds.every((r) => r.status === 200) &&
        refQty === 40 &&
        polloQty === 10 &&
        mesaFinal.total === 40 * 22 + 10 * 180 &&
        mesaFinal.version === 41,
      `40 agregados simultáneos a una mesa: 40 refrescos, 10 pollos, $${mesaFinal.total}, versión ${mesaFinal.version} (${tally(adds.map((r) => r.status))})`
    )
    const stockAntes = (
      await q<{ s: number }>(sql`select stock as s from products where id = ${refresco.id}`)
    )[0].s
    const lineas = mesaFinal.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      optionIds: i.optionIds
    }))
    const cobros = await Promise.all(
      cajas.map((c) =>
        c.call('/api/ventas', 'POST', {
          items: lineas,
          paymentMethod: 'CASH',
          amountPaid: 5000,
          orderId: mesa.id,
          orderVersion: mesaFinal.version
        })
      )
    )
    const stockDespues = (
      await q<{ s: number }>(sql`select stock as s from products where id = ${refresco.id}`)
    )[0].s
    check(
      cobros.filter((r) => r.status === 201).length === 1 &&
        Number(stockAntes) - Number(stockDespues) === 40,
      `${CAJAS} cajas cobran la misma mesa a la vez -> se cobra una vez y descuenta 40 refrescos (${tally(cobros.map((r) => r.status))})`
    )
    const addTrasCobro = await cajas[1].call(`/api/cuentas-abiertas/${mesa.id}/agregar`, 'POST', {
      items: [{ productId: refresco.id, quantity: 1 }]
    })
    check(addTrasCobro.status === 409, 'agregar a una mesa ya cobrada -> 409')

    // ================= 5. Encargos =================
    const pickupAt = Math.floor(Date.now() / 1000) + 3600
    const encargoBody = {
      customerName: 'Rosa',
      pickupAt,
      items: [{ productId: paquete.id, quantity: 2, optionIds: [natural(paquete)] }],
      deposit: 100,
      depositMethod: 'CASH',
      amountPaid: 100,
      clientRequestId: 'estres-encargo-1'
    }
    const dobles = await Promise.all(
      Array.from({ length: 5 }, () => cajas[0].call('/api/encargos', 'POST', encargoBody))
    )
    const [{ n: encargosRosa, ventas: anticiposRosa }] = await q<{ n: number; ventas: number }>(
      sql`select count(*)::int as n, count(deposit_sale_id)::int as ventas from orders where customer_name = 'Rosa'`
    )
    check(
      Number(encargosRosa) === 1 && Number(anticiposRosa) === 1,
      `5 envíos del mismo encargo -> 1 encargo y 1 anticipo cobrado (${tally(dobles.map((r) => r.status))})`
    )
    const encargo = ((await dobles.find((r) => r.status === 201)!.json()) as CreateOrderResponse)
      .order
    const entregas = await Promise.all(
      cajas.map((c) =>
        c.call('/api/ventas', 'POST', {
          items: [{ productId: paquete.id, quantity: 2, optionIds: [natural(paquete)] }],
          paymentMethod: 'CASH',
          amountPaid: 1000,
          orderId: encargo.id
        })
      )
    )
    check(
      entregas.filter((r) => r.status === 201).length === 1,
      `${CAJAS} cajas entregan el mismo encargo a la vez -> una entrega (${tally(entregas.map((r) => r.status))})`
    )
    // Entregar contra cancelar (con devolución) al mismo tiempo: sólo uno gana.
    let ganaUno = 0
    for (let i = 0; i < 10; i++) {
      const e = (
        (await (
          await cajas[2].call('/api/encargos', 'POST', {
            customerName: `Carrera ${i}`,
            pickupAt,
            items: [{ productId: refresco.id, quantity: 1 }],
            deposit: 22,
            depositMethod: 'CASH',
            amountPaid: 22
          })
        ).json()) as CreateOrderResponse
      ).order
      const [ent, can] = await Promise.all([
        cajas[2].call('/api/ventas', 'POST', {
          items: [{ productId: refresco.id, quantity: 1 }],
          paymentMethod: 'CASH',
          amountPaid: 0,
          orderId: e.id
        }),
        cajas[3].call(`/api/encargos/${e.id}/cancelar`, 'POST', { refund: true })
      ])
      if ((ent.status === 201) !== (can.status === 200)) ganaUno++
      else console.log(`  · carrera ${i}: entrega ${ent.status}, cancelación ${can.status}`)
    }
    check(
      ganaUno === 10,
      `entregar contra cancelar a la vez: siempre gana sólo uno (${ganaUno}/10)`
    )

    // ================= 6. Cortes =================
    for (const caja of cajas) {
      const res = await caja.call('/api/caja/resumen')
      const s = (await res.json()) as { session: { id: number }; expectedCash: number }
      const [row] = await q<{ esperado: number }>(
        sql`select (
          (select opening_amount from cash_sessions where id = ${s.session.id})
          + coalesce((select sum(total) from sales where cash_session_id = ${s.session.id} and payment_method = 'CASH'), 0)
          + coalesce((select sum(amount_paid) from sales where cash_session_id = ${s.session.id} and payment_method = 'CREDIT'), 0)
          + coalesce((select sum(amount) from credit_payments where cash_session_id = ${s.session.id} and payment_method = 'CASH'), 0)
          + coalesce((select sum(case when type = 'IN' then amount else -amount end) from cash_movements where cash_session_id = ${s.session.id}), 0)
        ) as esperado`
      )
      check(
        Math.round(s.expectedCash * 100) === Number(row.esperado),
        `corte de ${caja.name}: esperado $${s.expectedCash} = BD $${Number(row.esperado) / 100}`
      )
    }

    // ================= Carga sostenida =================
    const TOTAL = 1000
    const PARALELO = 25
    const tiempos: number[] = []
    const estados: number[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < TOTAL) {
        const i = next++
        const t = performance.now()
        const r = await cajas[i % CAJAS].call('/api/ventas', 'POST', {
          items: [
            { productId: medio.id, quantity: 1, optionIds: [natural(medio)] },
            { productId: refresco.id, quantity: 2 }
          ],
          paymentMethod: 'CARD'
        })
        tiempos.push(performance.now() - t)
        estados.push(r.status)
      }
    }
    const tc = Date.now()
    await Promise.all(Array.from({ length: PARALELO }, worker))
    const segs = (Date.now() - tc) / 1000
    tiempos.sort((a, b) => a - b)
    const p95 = Math.round(tiempos[Math.floor(tiempos.length * 0.95)])
    check(
      estados.every((x) => x === 201) && p95 < 1000,
      `carga: ${TOTAL} ventas con ${PARALELO} en paralelo en ${segs.toFixed(1)} s (${Math.round(TOTAL / segs)}/s, p95 ${p95} ms; ${tally(estados)})`
    )
    for (const path of [
      '/api/dashboard',
      `/api/reportes/mensual?mes=${new Date().getMonth() + 1}&anio=${new Date().getFullYear()}`,
      '/api/ventas?page=1&pageSize=100',
      '/api/inventario'
    ]) {
      const t = performance.now()
      const r = await asAdmin(path)
      const ms = Math.round(performance.now() - t)
      check(r.status === 200 && ms < 2000, `${path} con ~1,300 ventas: ${r.status} en ${ms} ms`)
    }

    // ================= 7. Fuerza bruta en el login =================
    const intentos = await Promise.all(
      Array.from({ length: 30 }, () =>
        fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ username: 'admin', password: 'mala' })
        })
      )
    )
    check(
      intentos.some((r) => r.status === 429),
      `30 contraseñas malas seguidas -> se bloquea (${tally(intentos.map((r) => r.status))})`
    )
  } finally {
    if (server) await server.close()
    await closeDb()
    rmSync(dir, { recursive: true, force: true })
    await pgAdmin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await pgAdmin.end()
  }
  if (problems.length) {
    console.log(`\n❌ ${problems.length} problema(s):\n - ${problems.join('\n - ')}`)
    process.exit(1)
  }
  console.log('\n✅ QA de estrés sin problemas')
}

main().catch((err) => {
  console.error('\n❌ QA de estrés falló\n', err)
  process.exit(1)
})
