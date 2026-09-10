/**
 * Verifica que `schema.sqlite.ts` y `schema.pg.ts` declaren EXACTAMENTE las
 * mismas tablas y columnas (nombre físico, tipo lógico, nullability, si tiene
 * default). La Fase 2 (motor agnóstico) depende de esa paridad, y hoy los dos
 * archivos se mantienen a mano — este chequeo la vuelve mecánica.
 *
 *   pnpm check:schema
 *
 * Se ejecuta también al principio de `verify:backend`.
 */
import { getTableColumns } from 'drizzle-orm'
import * as pg from '../src/main/db/schema.pg'
import * as sqlite from '../src/main/db/schema.sqlite'

/** Colapsa los tipos de columna de cada dialecto a un tipo lógico común. */
function logicalType(columnType: string): string {
  if (/Integer$/.test(columnType)) return 'int'
  if (/(Real|DoublePrecision|Numeric|Double)$/.test(columnType)) return 'float'
  if (/Text$/.test(columnType)) return 'text'
  if (/(Boolean)$/.test(columnType)) return 'bool'
  return columnType // desconocido → se compara tal cual (fallará si difieren)
}

interface ColShape {
  name: string
  type: string
  notNull: boolean
  hasDefault: boolean
}

function shapeOf(table: unknown): Map<string, ColShape> {
  const cols = getTableColumns(table as never)
  const out = new Map<string, ColShape>()
  for (const [key, col] of Object.entries(cols)) {
    const c = col as { name: string; columnType: string; notNull: boolean; hasDefault: boolean }
    out.set(key, {
      name: c.name,
      type: logicalType(c.columnType),
      notNull: c.notNull,
      hasDefault: c.hasDefault
    })
  }
  return out
}

const TABLES = [
  'users',
  'categories',
  'products',
  'cashSessions',
  'sales',
  'saleItems',
  'customers',
  'creditAccounts',
  'creditPayments',
  'config',
  'license'
] as const

function main(): void {
  const problems: string[] = []

  const sqliteTables = new Set(Object.keys(sqlite).filter((k) => k in pg))
  for (const t of TABLES) {
    if (!(t in sqlite)) problems.push(`tabla ausente en schema.sqlite.ts: ${t}`)
    if (!(t in pg)) problems.push(`tabla ausente en schema.pg.ts: ${t}`)
    sqliteTables.delete(t)
  }
  for (const extra of sqliteTables) {
    // objeto exportado por ambos pero no listado arriba → probablemente una tabla nueva
    if (
      typeof (sqlite as Record<string, unknown>)[extra] === 'object' &&
      (sqlite as Record<string, unknown>)[extra] !== null
    ) {
      problems.push(`tabla no listada en check-schema-parity.ts: ${extra}`)
    }
  }

  for (const t of TABLES) {
    if (!(t in sqlite) || !(t in pg)) continue
    const s = shapeOf((sqlite as Record<string, unknown>)[t])
    const p = shapeOf((pg as Record<string, unknown>)[t])

    for (const [key, sc] of s) {
      const pc = p.get(key)
      if (!pc) {
        problems.push(`${t}.${key}: en SQLite pero no en PostgreSQL`)
        continue
      }
      if (sc.name !== pc.name) problems.push(`${t}.${key}: nombre ${sc.name} vs ${pc.name}`)
      if (sc.type !== pc.type)
        problems.push(`${t}.${key}: tipo lógico ${sc.type} (sqlite) vs ${pc.type} (pg)`)
      if (sc.notNull !== pc.notNull)
        problems.push(`${t}.${key}: notNull ${sc.notNull} vs ${pc.notNull}`)
      if (sc.hasDefault !== pc.hasDefault)
        problems.push(`${t}.${key}: hasDefault ${sc.hasDefault} vs ${pc.hasDefault}`)
    }
    for (const key of p.keys()) {
      if (!s.has(key)) problems.push(`${t}.${key}: en PostgreSQL pero no en SQLite`)
    }
  }

  if (problems.length > 0) {
    console.error('❌ Los esquemas SQLite y PostgreSQL divergen:\n  - ' + problems.join('\n  - '))
    process.exit(1)
  }
  console.log(`✓ Paridad de esquemas OK — ${TABLES.length} tablas idénticas en ambos dialectos.`)
}

main()
