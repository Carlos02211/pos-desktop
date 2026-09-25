/**
 * Migración de datos SQLite → PostgreSQL (Fase 2, día 1 del roadmap).
 *
 * Copia todas las filas de la base SQLite de Fase 1 a una base PostgreSQL ya
 * migrada. Preserva los IDs y reajusta las secuencias de identidad al final.
 *
 * Las columnas a copiar se derivan de `information_schema` de PostgreSQL (no se
 * hardcodean): para cada columna del destino se toma el valor de la fila SQLite
 * si existe, y si no, se deja que aplique el DEFAULT de PostgreSQL. Si una
 * columna del destino es NOT NULL, sin default, y no está en el origen, el
 * script aborta antes de tocar nada.
 *
 * Toda la copia va en UNA sola transacción: si algo falla, la base destino
 * queda intacta.
 *
 * Uso:
 *   DATABASE_URL=postgres://user:pass@host:5432/pos \
 *   pnpm migrate:sqlite-to-pg -- --source "/ruta/a/pos.db" [--truncate]
 *
 * Requisitos previos:
 *   1. PostgreSQL en marcha y base de datos creada.
 *   2. `resources/migrations-pg` presente (se empaqueta con el repo).
 *   El script aplica las migraciones pendientes antes de copiar.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { Pool, type PoolClient } from 'pg'

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const SOURCE = flag('source') ?? join(process.cwd(), '.data', 'pos.dev.db')
const TRUNCATE = args.includes('--truncate')
const DATABASE_URL = process.env.DATABASE_URL

/** Orden que respeta las claves foráneas (padres antes que hijos). */
const TABLE_ORDER = [
  'users',
  'categories',
  'products',
  'customers',
  'cash_sessions',
  'sales',
  'sale_items',
  'credit_accounts',
  'credit_payments',
  'config',
  'license'
] as const

interface PgColumn {
  name: string
  isNullable: boolean
  hasDefault: boolean
}

async function applyMigrations(pool: Pool): Promise<void> {
  const migrationsFolder = join(process.cwd(), 'resources', 'migrations-pg')
  if (!existsSync(migrationsFolder)) {
    throw new Error(`No existe ${migrationsFolder}.`)
  }
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  await migrate(drizzle(pool), { migrationsFolder })
  console.log('· migraciones de PostgreSQL aplicadas')
}

async function pgColumns(client: PoolClient, table: string): Promise<PgColumn[]> {
  const { rows } = await client.query<{
    column_name: string
    is_nullable: 'YES' | 'NO'
    column_default: string | null
    is_identity: 'YES' | 'NO'
  }>(
    `SELECT column_name, is_nullable, column_default, is_identity
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  )
  return rows.map((r) => ({
    name: r.column_name,
    isNullable: r.is_nullable === 'YES',
    hasDefault: r.column_default !== null || r.is_identity === 'YES'
  }))
}

function sqliteColumns(sqlite: Database.Database, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((r) => r.name))
}

/** Sumas de control para comparar origen y destino tras la copia. */
interface Checksum {
  rows: number
  salesTotal?: number
  itemsSubtotal?: number
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

async function main(): Promise<void> {
  if (!DATABASE_URL) throw new Error('Falta la variable de entorno DATABASE_URL.')
  if (!existsSync(SOURCE)) throw new Error(`No se encuentra la base SQLite origen: ${SOURCE}`)

  console.log(`SQLite origen : ${SOURCE}`)
  console.log(`PostgreSQL    : ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`)

  const sqlite = new Database(SOURCE, { readonly: true })
  const pool = new Pool({ connectionString: DATABASE_URL })

  try {
    await applyMigrations(pool)

    const client = await pool.connect()
    try {
      // ---- Plan de columnas por tabla + validación previa ----
      const plan = new Map<string, string[]>()
      const problems: string[] = []
      for (const table of TABLE_ORDER) {
        const dest = await pgColumns(client, table)
        const src = sqliteColumns(sqlite, table)
        const copy: string[] = []
        for (const col of dest) {
          if (src.has(col.name)) {
            copy.push(col.name)
          } else if (!col.isNullable && !col.hasDefault) {
            problems.push(`${table}.${col.name}: NOT NULL sin default y ausente en el origen`)
          }
        }
        plan.set(table, copy)
      }
      if (problems.length > 0) {
        throw new Error(
          'El esquema de destino tiene columnas que el origen no puede rellenar:\n  - ' +
            problems.join('\n  - ')
        )
      }

      // ---- Sumas de control del ORIGEN ----
      const before = new Map<string, Checksum>()
      for (const table of TABLE_ORDER) {
        before.set(table, checksumSqlite(sqlite, table))
      }

      // ---- Copia (todo en una transacción) ----
      await client.query('BEGIN')

      if (TRUNCATE) {
        const list = [...TABLE_ORDER].map((t) => `"${t}"`).join(', ')
        await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
        console.log('· tablas destino vaciadas (--truncate)')
      }

      let totalRows = 0
      for (const table of TABLE_ORDER) {
        const columns = plan.get(table)!
        const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
        if (rows.length === 0) {
          console.log(`· ${table}: 0 filas`)
          continue
        }
        const colList = columns.map((c) => `"${c}"`).join(', ')
        for (const row of rows) {
          const values = columns.map((c) => row[c] ?? null)
          const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
          await client.query(
            `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
            values
          )
        }
        totalRows += rows.length
        console.log(`· ${table}: ${rows.length} filas`)
      }

      // ---- Reajuste de secuencias de identidad ----
      for (const table of TABLE_ORDER) {
        if (!plan.get(table)!.includes('id')) continue
        await client.query(
          `SELECT setval(
             pg_get_serial_sequence('"${table}"', 'id'),
             GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1),
             (SELECT COUNT(*) > 0 FROM "${table}")
           )`
        )
      }

      // ---- Verificación: comparar sumas de control ORIGEN vs DESTINO ----
      const mismatches: string[] = []
      for (const table of TABLE_ORDER) {
        const b = before.get(table)!
        const a = await checksumPg(client, table)
        if (a.rows !== b.rows) mismatches.push(`${table}: filas ${b.rows} → ${a.rows}`)
        if (b.salesTotal !== undefined && round2(b.salesTotal) !== round2(a.salesTotal ?? -1)) {
          mismatches.push(
            `${table}: sum(total) ${round2(b.salesTotal)} → ${round2(a.salesTotal ?? 0)}`
          )
        }
        if (
          b.itemsSubtotal !== undefined &&
          round2(b.itemsSubtotal) !== round2(a.itemsSubtotal ?? -1)
        ) {
          mismatches.push(
            `${table}: sum(subtotal) ${round2(b.itemsSubtotal)} → ${round2(a.itemsSubtotal ?? 0)}`
          )
        }
      }
      if (mismatches.length > 0) {
        throw new Error(
          'Verificación post-copia falló (ROLLBACK):\n  - ' + mismatches.join('\n  - ')
        )
      }

      await client.query('COMMIT')
      console.log('· secuencias reajustadas · verificación de sumas de control OK')
      console.log(`\n✅ Migración completada — ${totalRows} filas copiadas.`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  } finally {
    sqlite.close()
    await pool.end()
  }
}

function checksumSqlite(sqlite: Database.Database, table: string): Checksum {
  const [{ n }] = sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).all() as { n: number }[]
  const out: Checksum = { rows: Number(n) }
  if (table === 'sales') {
    const [{ s }] = sqlite.prepare(`SELECT COALESCE(SUM(total),0) s FROM sales`).all() as {
      s: number
    }[]
    out.salesTotal = Number(s)
  }
  if (table === 'sale_items') {
    const [{ s }] = sqlite.prepare(`SELECT COALESCE(SUM(subtotal),0) s FROM sale_items`).all() as {
      s: number
    }[]
    out.itemsSubtotal = Number(s)
  }
  return out
}

async function checksumPg(client: PoolClient, table: string): Promise<Checksum> {
  const { rows } = await client.query<{ n: string }>(`SELECT COUNT(*) n FROM "${table}"`)
  const out: Checksum = { rows: Number(rows[0].n) }
  if (table === 'sales') {
    const r = await client.query<{ s: string }>(`SELECT COALESCE(SUM(total),0) s FROM sales`)
    out.salesTotal = Number(r.rows[0].s)
  }
  if (table === 'sale_items') {
    const r = await client.query<{ s: string }>(
      `SELECT COALESCE(SUM(subtotal),0) s FROM sale_items`
    )
    out.itemsSubtotal = Number(r.rows[0].s)
  }
  return out
}

main().catch((err) => {
  console.error('\n❌ Migración fallida\n', err)
  process.exit(1)
})
