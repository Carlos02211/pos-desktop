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
