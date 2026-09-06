/**
 * Verificación de backend sin GUI (Sprints 0–1).
 *
 * Reproduce lo que hace el Main Process al arrancar, pero fuera de Electron:
 *   1. Store cifrado + SQLite en un directorio temporal, con migraciones y seed.
 *   2. Levanta Fastify + Socket.io en :3001.
 *   3. Sprint 0 — GET /api/ping (Renderer -> Fastify -> SQLite) + validación Zod.
 *   4. Sprint 1 — licencia por hardware: estado, activación con clave inválida y válida.
 *   5. Sprint 1 — auth: login correcto/incorrecto, JWT en /api/auth/me, roles.
 *
 * Uso:  pnpm verify:backend
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { count, eq } from 'drizzle-orm'
import { closeDb, initDb } from '../src/main/db'
import { users } from '../src/main/db/schema'
import { runSeed } from '../src/main/db/seed'
import { initStore } from '../src/main/lib/store'
import { startServer } from '../src/main/server'
import { expectedKeyForFingerprint, getHardwareFingerprint } from '../src/main/services/license'
import type { LicenseStatusResponse, LoginResponse, PingResponse } from '../src/shared/types'

const MIGRATIONS = join(process.cwd(), 'resources', 'migrations')
const PORT = 3001

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`)
  console.log(`✓ ${msg}`)
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pos-verify-'))
  let server: Awaited<ReturnType<typeof startServer>> | null = null

  try {
    initStore(dir)
    const db = initDb(join(dir, 'pos.db'), MIGRATIONS)
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

    server = await startServer({ port: PORT, version: '0.1.0', isDev: false })
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

    console.log('\n✅ Backend verificado — Sprints 0–1 OK')
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
