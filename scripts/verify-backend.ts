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
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { count, eq } from 'drizzle-orm'
import { closeDb, initDb } from '../src/main/db'
import { users } from '../src/main/db/schema'
import { runSeed } from '../src/main/db/seed'
import { getStore, initStore } from '../src/main/lib/store'
import { startServer } from '../src/main/server'
import { expectedKeyForFingerprint, getHardwareFingerprint } from '../src/main/services/license'
import type {
  CashSession,
  CashSessionListItem,
  CashSessionSummary,
  Category,
  CategoryWithCount,
  ConfigResponse,
  CreateSaleResponse,
  LicenseStatusResponse,
  LoginResponse,
  PingResponse,
  ProductWithCategory,
  SalesPage,
  SalesReport,
  SaleWithItems,
  UserListItem
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
        cortes[0].difference === -10,
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

    console.log('\n✅ Backend verificado — Sprints 0–8 OK')
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
