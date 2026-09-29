import { sql } from 'drizzle-orm'
import { DIALECT, type DB } from './index'

/**
 * Ejecuta `fn` dentro de una transacción, de forma portable entre dialectos.
 *
 * - PostgreSQL: usa la transacción nativa de Drizzle (callback asíncrono).
 * - SQLite (better-sqlite3): su `.transaction()` no acepta callbacks asíncronos,
 *   así que se emula con `BEGIN` / `COMMIT` / `ROLLBACK`. Es seguro porque el
 *   driver es síncrono: no hay hueco real de asincronía entre sentencias.
 *
 * No se usan transacciones anidadas (savepoints) en el proyecto.
 */
/**
 * Serializa las transacciones que tocan una misma fila.
 *
 * - PostgreSQL: `SELECT ... FOR UPDATE` — la segunda transacción espera a que la
 *   primera haga commit/rollback antes de leer la fila. Evita el "lost update"
 *   en saldos de cuentas y las carreras de folio de venta.
 * - SQLite: no-op (better-sqlite3 es síncrono y serializa todas las escrituras).
 *
 * `table` es un nombre físico de tabla escrito en el propio código (no entra
 * input del usuario). Devuelve `true` si la fila existe.
 */
export type LockableTable = 'cash_sessions' | 'credit_accounts'

export async function lockRow(tx: DB, table: LockableTable, id: number): Promise<boolean> {
  if (DIALECT !== 'pg') return true
  const runner = tx as unknown as { execute: (q: unknown) => Promise<{ rows: unknown[] }> }
  const res = await runner.execute(
    sql`select 1 from ${sql.identifier(table)} where id = ${id} for update`
  )
  return res.rows.length > 0
}

/**
 * Bloquea la sesión de caja y confirma que SIGUE abierta.
 *
 * Quien espera el lock leyó la sesión como OPEN antes de esperar; si el que tenía el lock
 * era un cierre, al soltarlo la sesión ya está CLOSED. Sin esta relectura, la venta (o el
 * abono, o el movimiento) se guardaba en una caja cuyo corte ya se calculó.
 * En SQLite no hay espera posible: la lectura previa, en la misma transacción, basta.
 */
export async function lockOpenSession(tx: DB, sessionId: number): Promise<boolean> {
  if (DIALECT !== 'pg') return true
  const runner = tx as unknown as { execute: (q: unknown) => Promise<{ rows: unknown[] }> }
  const res = await runner.execute(
    sql`select status from cash_sessions where id = ${sessionId} for update`
  )
  return (res.rows[0] as { status?: string } | undefined)?.status === 'OPEN'
}

export async function withTx<T>(db: DB, fn: (tx: DB) => Promise<T>): Promise<T> {
  if (DIALECT === 'pg') {
    return db.transaction((tx) => fn(tx as unknown as DB))
  }

  const raw = db as unknown as { run: (query: unknown) => unknown }
  await raw.run(sql`BEGIN`)
  try {
    const result = await fn(db)
    await raw.run(sql`COMMIT`)
    return result
  } catch (err) {
    try {
      await raw.run(sql`ROLLBACK`)
    } catch {
      /* la conexión ya no está en transacción: nada que revertir */
    }
    throw err
  }
}
