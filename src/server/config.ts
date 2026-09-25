import './load-env' // idempotente; garantiza el .env aunque config se importe suelto
import { X509Certificate } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Configuración del servidor standalone (Fase 2), toda por variables de entorno
 * (el `.env` lo carga `./load-env`, importado como primera línea del entry).
 */

function loadTls(): { key: Buffer; cert: Buffer; ca?: Buffer } | undefined {
  const keyPath = process.env.POS_TLS_KEY
  const certPath = process.env.POS_TLS_CERT
  if (!keyPath && !certPath) return undefined
  if (!keyPath || !certPath) {
    throw new Error('POS_TLS_KEY y POS_TLS_CERT deben definirse juntos (o ninguno).')
  }
  const cert = readFileSync(resolve(certPath))
  warnIfExpiring(cert)
  const caPath = process.env.POS_TLS_CA
  return {
    key: readFileSync(resolve(keyPath)),
    cert,
    ...(caPath ? { ca: readFileSync(resolve(caPath)) } : {})
  }
}

/** Los certificados de mkcert duran ~2 años: avisar en el log con tiempo para renovarlo. */
function warnIfExpiring(pem: Buffer): void {
  const validTo = new Date(new X509Certificate(pem).validTo)
  const days = Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
  if (days < 0) {
    console.error(
      `[tls] El certificado VENCIÓ el ${validTo.toISOString().slice(0, 10)} — las cajas ` +
        'verán "no seguro". Renovarlo con setup-https.ps1.'
    )
  } else if (days <= 60) {
    console.warn(
      `[tls] El certificado vence en ${days} días (${validTo.toISOString().slice(0, 10)}). ` +
        'Renovarlo con setup-https.ps1.'
    )
  }
}

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
   * Vacío = sólo mismo origen (las tabletas cargan la SPA de este mismo servidor).
   * Sólo hace falta ponerlo si la SPA se sirve desde otro host/puerto.
   */
  allowedOrigins:
    process.env.POS_ALLOWED_ORIGINS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [],

  /** HTTPS si POS_TLS_KEY + POS_TLS_CERT apuntan a archivos PEM; si no, HTTP. */
  tls: loadTls(),

  version: process.env.npm_package_version ?? '0.1.0'
}

/**
 * Comprobaciones que deben cortar el arranque de un servidor de producción.
 * Se puede saltar (sólo para pruebas locales) con `POS_ALLOW_INSECURE=1`.
 */
export function assertProductionConfig(): void {
  if (process.env.POS_ALLOW_INSECURE === '1') {
    console.warn('[config] POS_ALLOW_INSECURE=1 — se omiten las validaciones de producción.')
    return
  }

  const errors: string[] = []

  // Fase 2 es multicajero → PostgreSQL. SQLite es mono-cliente y `withTx` no es
  // seguro con peticiones concurrentes (ver auditoría §C5).
  if (!process.env.DATABASE_URL) {
    errors.push(
      'DATABASE_URL no está definida. La Fase 2 requiere PostgreSQL ' +
        '(ej. postgres://pos:...@localhost:5432/pos).'
    )
  } else if (process.env.DATABASE_URL.startsWith('pglite://')) {
    errors.push('DATABASE_URL apunta a PGlite (embebido, mono-conexión) — usá PostgreSQL real.')
  }

  // JWT_SECRET es opcional (si no está, se autogenera y persiste en POS_DATA_DIR),
  // pero si se define tiene que ser suficientemente largo.
  if (process.env.JWT_SECRET !== undefined && process.env.JWT_SECRET.trim().length < 32) {
    errors.push('JWT_SECRET, si se define, debe tener al menos 32 caracteres.')
  }

  if (errors.length > 0) {
    console.error(
      '\n❌ El servidor no puede arrancar en producción:\n' +
        errors.map((e) => `   - ${e}`).join('\n') +
        '\n\n   (para pruebas locales podés forzar el arranque con POS_ALLOW_INSECURE=1)\n'
    )
    process.exit(1)
  }
}
