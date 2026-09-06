/**
 * Verificación de backend sin GUI (Sprint 0).
 *
 * Reproduce lo que hace el Main Process al arrancar, pero fuera de Electron:
 *   1. Inicializa SQLite en un archivo temporal y aplica las migraciones.
 *   2. Ejecuta el seed (admin / admin123 + categoría + producto).
 *   3. Levanta Fastify + Socket.io en :3001.
 *   4. Llama GET /api/ping y valida la respuesta.
 *   5. Comprueba que el seed dejó los datos esperados.
 *
 * Uso:  pnpm verify:backend
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { count, eq } from 'drizzle-orm'
import { closeDb, initDb } from '../src/main/db'
import { categories, products, users } from '../src/main/db/schema'
import { runSeed } from '../src/main/db/seed'
import { startServer } from '../src/main/server'
import type { PingResponse } from '../src/shared/types'

const MIGRATIONS = join(process.cwd(), 'resources', 'migrations')
const PORT = 3001

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`)
  console.log(`✓ ${msg}`)
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'pos-verify-'))
  const dbPath = join(dir, 'pos.db')
  let server: Awaited<ReturnType<typeof startServer>> | null = null

  try {
    const db = initDb(dbPath, MIGRATIONS)
    assert(true, 'SQLite inicializado y migraciones aplicadas')

    await runSeed(db)

    const [{ n: userCount }] = db.select({ n: count() }).from(users).all()
    assert(userCount === 1, `seed: 1 usuario creado (encontrados: ${userCount})`)
    const admin = db.select().from(users).where(eq(users.username, 'admin')).get()
    assert(admin?.role === 'ADMIN', 'seed: usuario "admin" con rol ADMIN')
    assert(admin!.password.startsWith('$2'), 'seed: contraseña guardada como hash bcrypt')

    const [{ n: catCount }] = db.select({ n: count() }).from(categories).all()
    assert(catCount === 1, `seed: 1 categoría creada (encontradas: ${catCount})`)
    const [{ n: prodCount }] = db.select({ n: count() }).from(products).all()
    assert(prodCount === 1, `seed: 1 producto creado (encontrados: ${prodCount})`)

    // El seed debe ser idempotente.
    await runSeed(db)
    const [{ n: userCount2 }] = db.select({ n: count() }).from(users).all()
    assert(userCount2 === 1, 'seed idempotente: no duplica datos en la segunda ejecución')

    server = await startServer({ port: PORT, version: '0.1.0', isDev: false })
    assert(true, `Fastify escuchando en ${server.url}`)

    const res = await fetch(`${server.url}/api/ping?echo=hola`)
    assert(res.ok, `GET /api/ping responde 200 (status: ${res.status})`)
    const body = (await res.json()) as PingResponse & { echo?: string }
    assert(body.ok === true, 'ping: ok = true')
    assert(body.service === 'pos-spartan-tech', 'ping: service correcto')
    assert(body.db === 'connected', 'ping: reporta SQLite conectado')
    assert(body.echo === 'hola', 'ping: valida y refleja el query param (Zod)')

    const bad = await fetch(`${server.url}/api/ping?echo=${'x'.repeat(200)}`)
    assert(bad.status === 400, `ping: rechaza query inválido con 400 (status: ${bad.status})`)

    console.log('\n✅ Backend verificado — Sprint 0 OK')
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
