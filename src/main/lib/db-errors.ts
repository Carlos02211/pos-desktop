/**
 * Detección de violaciones de restricción, portable entre better-sqlite3 y node-postgres.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string; cause?: unknown }
  // Drizzle envuelve el error del driver (DrizzleQueryError): el código real está en `cause`.
  if (e.cause && isUniqueViolation(e.cause)) return true
  // PostgreSQL: unique_violation
  if (e.code === '23505') return true
  // better-sqlite3
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
    return true
  return typeof e.message === 'string' && /UNIQUE constraint failed/i.test(e.message)
}
