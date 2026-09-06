import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Configuración del servidor standalone (Fase 2), toda por variables de entorno.
 * Se carga un `.env` del directorio de trabajo si existe.
 */

function loadDotEnv(): void {
  // Node 20.6+ trae `--env-file`, pero pm2 no siempre lo pasa: lo hacemos a mano.
  const path = resolve(process.cwd(), '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

loadDotEnv()

const dataDir = resolve(process.env.POS_DATA_DIR ?? './data')

export const serverConfig = {
  /** Puerto LAN. El spec de Fase 2 usa 3000. */
  port: Number(process.env.PORT ?? 3000),
  /** `0.0.0.0` para aceptar conexiones de las tabletas en la red local. */
  host: process.env.HOST ?? '0.0.0.0',

  dataDir,
  dbPath: resolve(process.env.POS_DB_PATH ?? `${dataDir}/pos.db`),
  backupDir: resolve(process.env.POS_BACKUP_DIR ?? `${dataDir}/backups`),
  uploadsDir: resolve(process.env.POS_UPLOADS_DIR ?? `${dataDir}/uploads`),

  /** Carpeta con el build de React (`out/renderer`). */
  staticDir: resolve(process.env.POS_STATIC_DIR ?? './public'),
  /** Carpeta de migraciones del dialecto activo. */
  migrationsDir: resolve(
    process.env.POS_MIGRATIONS_DIR ??
      (process.env.DATABASE_URL ? './migrations-pg' : './migrations')
  ),

  /**
   * Orígenes permitidos para CORS y Socket.io. Coma-separados.
   * Vacío = cualquiera (útil si sólo se sirve la SPA desde este mismo servidor).
   */
  allowedOrigins: (process.env.POS_ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? true) as string[] | true,

  version: process.env.npm_package_version ?? '0.1.0'
}
