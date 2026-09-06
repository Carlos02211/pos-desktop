import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type DB = BetterSQLite3Database<typeof schema>

let _db: DB | null = null
let _sqlite: Database.Database | null = null

/**
 * Crea una conexión Drizzle sobre un archivo SQLite.
 * No usa estado global — útil para tests y para el script de verificación.
 */
export function createDb(dbPath: string): { db: DB; sqlite: Database.Database } {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

/**
 * Inicializa el singleton de base de datos usado por el servidor Fastify.
 * Aplica las migraciones pendientes desde `migrationsFolder`.
 */
export function initDb(dbPath: string, migrationsFolder: string): DB {
  if (_db) return _db
  const { db, sqlite } = createDb(dbPath)
  if (existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder })
  } else {
    console.warn(`[db] Carpeta de migraciones no encontrada: ${migrationsFolder}`)
  }
  _db = db
  _sqlite = sqlite
  return _db
}

export function getDb(): DB {
  if (!_db) throw new Error('La base de datos no ha sido inicializada. Llama initDb() primero.')
  return _db
}

export function closeDb(): void {
  _sqlite?.close()
  _db = null
  _sqlite = null
}

export { schema }
