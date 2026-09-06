/**
 * Migración de datos SQLite → PostgreSQL (Fase 2, día 1 del roadmap).
 *
 * Copia todas las filas de la base de datos SQLite de Fase 1 a una base
 * PostgreSQL ya migrada (esquema creado). Preserva los IDs y reajusta las
 * secuencias de identidad al final.
 *
 * Uso:
 *   DATABASE_URL=postgres://user:pass@host:5432/pos \
 *   pnpm migrate:sqlite-to-pg -- --source "/ruta/a/pos.db" [--truncate]
 *
 * Requisitos previos:
 *   1. PostgreSQL en marcha y base de datos creada.
 *   2. `pnpm db:generate:pg` ya ejecutado (existe resources/migrations-pg).
 *   El script aplica las migraciones pendientes antes de copiar.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { Pool } from 'pg'

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const SOURCE = flag('source') ?? join(process.cwd(), '.data', 'pos.dev.db')
const TRUNCATE = args.includes('--truncate')
const DATABASE_URL = process.env.DATABASE_URL

// Orden que respeta las claves foráneas.
const TABLES = [
  { name: 'users', columns: ['id', 'username', 'password', 'role', 'active', 'created_at'] },
  { name: 'categories', columns: ['id', 'name', 'active'] },
  {
    name: 'products',
    columns: [
      'id',
      'name',
      'price',
      'category_id',
      'image_path',
      'active',
      'created_at',
      'updated_at'
    ]
  },
  { name: 'customers', columns: ['id', 'name', 'phone', 'notes', 'active', 'created_at'] },
  {
    name: 'cash_sessions',
    columns: [
      'id',
      'user_id',
      'opened_at',
      'closed_at',
      'opening_amount',
      'closing_amount',
      'expected_amount',
      'difference',
      'status'
    ]
  },
  {
    name: 'sales',
    columns: [
      'id',
      'cash_session_id',
      'user_id',
      'total',
      'payment_method',
      'amount_paid',
      'change',
      'ticket_number',
      'created_at'
    ]
  },
  {
    name: 'sale_items',
    columns: ['id', 'sale_id', 'product_id', 'name', 'price', 'quantity', 'subtotal']
  },
  {
    name: 'credit_accounts',
    columns: [
      'id',
      'sale_id',
      'customer_id',
      'user_id',
      'total',
      'paid',
      'status',
      'created_at',
      'closed_at'
    ]
  },
  {
    name: 'credit_payments',
    columns: [
      'id',
      'credit_account_id',
      'cash_session_id',
      'user_id',
      'amount',
      'payment_method',
      'created_at'
    ]
  },
  { name: 'config', columns: ['key', 'value'] },
  { name: 'license', columns: ['id', 'fingerprint', 'key', 'activated_at', 'status'] }
] as const

async function applyMigrations(pool: Pool): Promise<void> {
  const migrationsFolder = join(process.cwd(), 'resources', 'migrations-pg')
  if (!existsSync(migrationsFolder)) {
    throw new Error(`No existe ${migrationsFolder}. Ejecuta primero: pnpm db:generate:pg`)
  }
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  await migrate(drizzle(pool), { migrationsFolder })
  console.log('· migraciones de PostgreSQL aplicadas')
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

    if (TRUNCATE) {
      const list = [...TABLES].map((t) => `"${t.name}"`).join(', ')
      await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
      console.log('· tablas destino vaciadas (--truncate)')
    }

    let totalRows = 0
    for (const table of TABLES) {
      const rows = sqlite.prepare(`SELECT * FROM ${table.name}`).all() as Record<string, unknown>[]
      if (rows.length === 0) {
        console.log(`· ${table.name}: 0 filas`)
        continue
      }

      const cols = table.columns.map((c) => `"${c}"`).join(', ')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const row of rows) {
          const values = table.columns.map((c) => row[c] ?? null)
          const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
          await client.query(
            `INSERT INTO "${table.name}" (${cols}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
            values
          )
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }

      totalRows += rows.length
      console.log(`· ${table.name}: ${rows.length} filas`)
    }

    // Reajusta las secuencias de identidad al máximo ID copiado.
    for (const table of TABLES) {
      if (!(table.columns as readonly string[]).includes('id')) continue
      await pool.query(
        `SELECT setval(
           pg_get_serial_sequence('"${table.name}"', 'id'),
           GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table.name}"), 1),
           (SELECT COUNT(*) > 0 FROM "${table.name}")
         )`
      )
    }
    console.log('· secuencias de identidad reajustadas')

    console.log(`\n✅ Migración completada — ${totalRows} filas copiadas.`)
  } finally {
    sqlite.close()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('\n❌ Migración fallida\n', err)
  process.exit(1)
})
