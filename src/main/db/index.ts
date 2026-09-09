import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

/**
 * Capa de acceso a datos — agnóstica del motor.
 *
 * - Sin `DATABASE_URL`            → SQLite con better-sqlite3 (Fase 1 / Electron).
 * - `DATABASE_URL=postgres://…`   → PostgreSQL con node-postgres (Fase 2 / servidor).
 * - `DATABASE_URL=pglite://<dir>` → PostgreSQL embebido (sólo para `verify:backend:pg`).
 *
 * Todas las queries de Drizzle usan la API común a los dos dialectos; las
 * transacciones pasan por `withTx()` (ver `./tx.ts`).
 */

export type DbDialect = 'sqlite' | 'pg'

const url = process.env.DATABASE_URL?.trim()

export const DIALECT: DbDialect = url ? 'pg' : 'sqlite'

/** Instancia de Drizzle. Se tipa contra el dialecto asíncrono (PostgreSQL). */
export type DB = NodePgDatabase<Record<string, never>>

export interface DbHandle {
  db: DB
  /** Cierra la conexión subyacente. */
  close: () => Promise<void>
  /** Ejecuta un PRAGMA a nivel de conexión (sólo SQLite; no-op en PostgreSQL). */
  pragma?: (statement: string) => unknown
}

function isPglite(u: string): boolean {
  return u.startsWith('pglite:')
}

/** Ruta/URL de la carpeta de datos de PGlite a partir de `pglite://<algo>`. */
function pgliteTarget(u: string): string | undefined {
  const rest = u.replace(/^pglite:(\/\/)?/, '')
  return rest && rest !== 'memory' ? rest : undefined
}

/**
 * Crea una conexión Drizzle nueva (sin estado global).
 * `sqlitePath` sólo se usa en el dialecto SQLite.
 */
export async function createDb(sqlitePath: string): Promise<DbHandle> {
  if (DIALECT === 'pg' && url) {
    if (isPglite(url)) {
      const { PGlite } = await import('@electric-sql/pglite')
      const { drizzle } = await import('drizzle-orm/pglite')
      const client = new PGlite(pgliteTarget(url))
      return {
        db: drizzle(client) as unknown as DB,
        close: async () => {
          await client.close()
        }
      }
    }
    const { Pool } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const pool = new Pool({ connectionString: url })
    return {
      db: drizzle(pool) as unknown as DB,
      close: async () => {
        await pool.end()
      }
    }
  }

  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = new Database(sqlitePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')
  return {
    db: drizzle(sqlite, { schema }) as unknown as DB,
    close: async () => {
      sqlite.close()
    },
    pragma: (statement: string) => sqlite.pragma(statement)
  }
}

let _handle: DbHandle | null = null

/**
 * Inicializa el singleton de base de datos usado por el servidor Fastify y
 * aplica las migraciones pendientes.
 *
 * @param sqlitePath        ruta del archivo SQLite (ignorado en PostgreSQL)
 * @param migrationsFolder  carpeta de migraciones del dialecto activo
 */
export async function initDb(sqlitePath: string, migrationsFolder: string): Promise<DB> {
  if (_handle) return _handle.db
  const handle = await createDb(sqlitePath)

  if (existsSync(migrationsFolder)) {
    // Las migraciones de SQLite que reconstruyen tablas (cambio de tipo de columna)
    // necesitan las FK desactivadas: `PRAGMA foreign_keys=OFF` DENTRO de una migración
    // es no-op (va en transacción), así que se hace a nivel de conexión.
    if (DIALECT === 'sqlite') handle.pragma?.('foreign_keys = OFF')
    await migrateFor(handle.db, migrationsFolder)
    if (DIALECT === 'sqlite') {
      const violations = handle.pragma?.('foreign_key_check')
      if (Array.isArray(violations) && violations.length > 0) {
        throw new Error(
          `Migración dejó violaciones de clave foránea: ${JSON.stringify(violations)}`
        )
      }
      handle.pragma?.('foreign_keys = ON')
    }
  } else {
    console.warn(`[db] Carpeta de migraciones no encontrada: ${migrationsFolder}`)
  }

  _handle = handle
  return handle.db
}

async function migrateFor(db: DB, migrationsFolder: string): Promise<void> {
  if (DIALECT === 'pg' && url && isPglite(url)) {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(db as never, { migrationsFolder })
    return
  }
  if (DIALECT === 'pg') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    await migrate(db as never, { migrationsFolder })
    return
  }
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  migrate(db as never, { migrationsFolder })
}

export function getDb(): DB {
  if (!_handle) throw new Error('La base de datos no ha sido inicializada. Llama initDb() primero.')
  return _handle.db
}

export async function closeDb(): Promise<void> {
  await _handle?.close()
  _handle = null
}

/** Comprobación de vida de la base de datos (para `GET /api/ping`). */
export async function pingDb(): Promise<void> {
  const db = getDb()
  if (DIALECT === 'pg') {
    await db.execute(sql`select 1`)
  } else {
    await (db as unknown as { get: (query: unknown) => unknown }).get(sql`select 1`)
  }
}

export { schema }
