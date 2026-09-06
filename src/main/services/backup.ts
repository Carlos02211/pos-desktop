import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

const KEEP = 30

export interface BackupResult {
  ok: boolean
  path?: string
  error?: string
}

/**
 * Copia `pos.db` a la carpeta de respaldo con marca de tiempo y conserva
 * sólo los últimos 30. Se ejecuta SIEMPRE al cerrar caja (no es opcional).
 * Nunca lanza: un fallo de respaldo no debe impedir cerrar la caja.
 */
export function backupDatabase(dbPath: string, backupDir: string): BackupResult {
  try {
    if (!existsSync(dbPath)) return { ok: false, error: 'No existe la base de datos' }
    mkdirSync(backupDir, { recursive: true })

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(backupDir, `pos_${stamp}.db`)
    copyFileSync(dbPath, dest)

    const backups = readdirSync(backupDir)
      .filter((f) => f.startsWith('pos_') && f.endsWith('.db'))
      .sort()
    for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) {
      unlinkSync(join(backupDir, old))
    }

    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de respaldo' }
  }
}
