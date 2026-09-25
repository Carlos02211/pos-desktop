import { execFile } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { DIALECT, getDb } from '../db'
import { getConfigMap } from './config'

const execFileAsync = promisify(execFile)

/** Respaldos que se conservan en la carpeta (los más viejos se borran). */
const KEEP = 30
const PREFIX = 'pos_'
const EXTENSIONS = ['.db', '.dump']
/** Tope para pg_dump: una base de un negocio chico tarda segundos. */
const PG_DUMP_TIMEOUT_MS = 5 * 60_000

export interface BackupResult {
  ok: boolean
  path?: string
  sizeBytes?: number
  error?: string
  /** El motor no admite respaldo desde la app (p. ej. PGlite embebido en pruebas). */
  skipped?: string
}

export interface BackupFile {
  name: string
  path: string
  sizeBytes: number
  /** epoch en segundos */
  createdAt: number
}

export interface BackupTarget {
  dialect: 'sqlite' | 'pg'
  /** Archivo SQLite (Fase 1). */
  dbPath: string
  /** `postgres://…` (Fase 2). */
  databaseUrl?: string
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Respaldos de la carpeta, del más nuevo al más viejo. */
export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && EXTENSIONS.some((ext) => f.endsWith(ext)))
    .map((name) => {
      const path = join(dir, name)
      const st = statSync(path)
      return { name, path, sizeBytes: st.size, createdAt: Math.floor(st.mtimeMs / 1000) }
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name))
}

function prune(dir: string): void {
  for (const old of listBackups(dir).slice(KEEP)) unlinkSync(old.path)
}

/**
 * `pg_dump` del PostgreSQL instalado. Orden: `POS_PG_DUMP` en el `.env` → la versión más
 * nueva en `C:\Program Files\PostgreSQL\<ver>\bin` (Windows) → `pg_dump` del PATH.
 */
export function findPgDump(): string {
  if (process.env.POS_PG_DUMP) return process.env.POS_PG_DUMP
  if (process.platform === 'win32') {
    const base = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL')
    if (existsSync(base)) {
      const versions = readdirSync(base)
        .filter((v) => /^\d+(\.\d+)?$/.test(v))
        .sort((a, b) => Number(b) - Number(a))
      for (const v of versions) {
        const exe = join(base, v, 'bin', 'pg_dump.exe')
        if (existsSync(exe)) return exe
      }
    }
  }
  return 'pg_dump'
}

function pgRestoreNextTo(pgDump: string): string {
  if (pgDump === 'pg_dump') return 'pg_restore'
  const exe = pgDump.toLowerCase().endsWith('.exe') ? 'pg_restore.exe' : 'pg_restore'
  return join(dirname(pgDump), exe)
}

async function backupPostgres(databaseUrl: string, dir: string): Promise<BackupResult> {
  const pgDump = findPgDump()
  const dest = join(dir, `${PREFIX}${stamp()}.dump`)
  try {
    // La contraseña va por PGPASSWORD y no en la URL: los argumentos de un proceso los
    // puede ver cualquiera en la lista de procesos.
    const url = new URL(databaseUrl)
    const password = decodeURIComponent(url.password)
    url.password = ''
    await execFileAsync(pgDump, ['--format=custom', `--file=${dest}`, `--dbname=${url.href}`], {
      timeout: PG_DUMP_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, PGPASSWORD: password }
    })
    // Que el archivo se pueda leer (detecta un dump truncado/corrupto).
    await execFileAsync(pgRestoreNextTo(pgDump), ['--list', dest], {
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (err) {
    if (existsSync(dest)) unlinkSync(dest)
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    if (e.code === 'ENOENT') {
      return {
        ok: false,
        error:
          'No se encontró pg_dump (viene con PostgreSQL). Si PostgreSQL está en otra ' +
          'carpeta, definí POS_PG_DUMP en el .env con la ruta a pg_dump.exe.'
      }
    }
    const detail = (e.stderr || e.message || '').toString().trim().split('\n')[0]
    return { ok: false, error: `pg_dump falló: ${detail}` }
  }
  return { ok: true, path: dest, sizeBytes: statSync(dest).size }
}

function backupSqlite(dbPath: string, dir: string): BackupResult {
  if (!existsSync(dbPath)) return { ok: false, error: 'No existe la base de datos' }
  const dest = join(dir, `${PREFIX}${stamp()}.db`)
  copyFileSync(dbPath, dest)
  return { ok: true, path: dest, sizeBytes: statSync(dest).size }
}

/**
 * Respalda la base a `dir` y conserva los últimos 30. NUNCA lanza: un respaldo fallido
 * no debe impedir, p. ej., cerrar la caja — se informa en el resultado.
 */
export async function runBackup(target: BackupTarget, dir: string): Promise<BackupResult> {
  const result = await runBackupInner(target, dir)
  if (!result.skipped) {
    lastAttempt = { at: Math.floor(Date.now() / 1000), ok: result.ok, error: result.error }
  }
  return result
}

let lastAttempt: { at: number; ok: boolean; error?: string } | null = null

/** Último intento de respaldo (ok o fallido) desde que arrancó el proceso. */
export function getLastAttempt(): typeof lastAttempt {
  return lastAttempt
}

async function runBackupInner(target: BackupTarget, dir: string): Promise<BackupResult> {
  try {
    if (target.dialect === 'pg' && target.databaseUrl?.startsWith('pglite://')) {
      return { ok: true, skipped: 'PGlite (sólo pruebas) no admite respaldo con pg_dump' }
    }
    const writable = checkWritable(dir)
    if (!writable.ok) return { ok: false, error: writable.error }
    const result =
      target.dialect === 'pg'
        ? await backupPostgres(target.databaseUrl ?? '', dir)
        : backupSqlite(target.dbPath, dir)
    if (result.ok) prune(dir)
    return result
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de respaldo' }
  }
}

/**
 * ¿El proceso del servidor puede escribir en `dir`? (En Windows el servidor corre como
 * "Servicio local", que no tiene permiso en cualquier carpeta.) Crea la carpeta si falta.
 */
export function checkWritable(dir: string): { ok: true } | { ok: false; error: string } {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.pos-prueba-${process.pid}-${Date.now()}`)
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return {
      ok: false,
      error:
        code === 'EACCES' || code === 'EPERM'
          ? 'El servidor no tiene permiso para escribir en esa carpeta.'
          : err instanceof Error
            ? err.message
            : 'No se pudo escribir en la carpeta.'
    }
  }
}

/** Qué respaldar y adónde: `config.backup_dir` o, si está vacío, la carpeta de datos. */
export async function resolveBackupJob(ctx: {
  dbPath: string
  backupDir: string
}): Promise<{ target: BackupTarget; dir: string; isDefaultDir: boolean }> {
  const custom = (await getConfigMap(getDb())).backup_dir?.trim()
  return {
    target: { dialect: DIALECT, dbPath: ctx.dbPath, databaseUrl: process.env.DATABASE_URL },
    dir: custom || ctx.backupDir,
    isDefaultDir: !custom
  }
}

const HOUR_MS = 60 * 60_000

/**
 * Respaldo automático diario (servidor de Fase 2): cada hora mira el respaldo más nuevo de
 * la carpeta y, si tiene más de 24 h (o no hay ninguno), hace uno. Así el negocio queda
 * respaldado aunque un día no se cierre caja, sin tareas programadas de Windows.
 */
export function startAutoBackup(ctx: { dbPath: string; backupDir: string }): () => void {
  const check = async (): Promise<void> => {
    try {
      const { target, dir } = await resolveBackupJob(ctx)
      const newest = listBackups(dir)[0]
      if (newest && Date.now() / 1000 - newest.createdAt < 24 * 3600) return
      const r = await runBackup(target, dir)
      if (r.skipped) return
      if (r.ok) console.log(`[respaldo] automático OK → ${r.path}`)
      else console.error(`[respaldo] automático FALLÓ: ${r.error}`)
    } catch (err) {
      console.error('[respaldo] automático FALLÓ:', err)
    }
  }
  const first = setTimeout(() => void check(), 2 * 60_000)
  const every = setInterval(() => void check(), HOUR_MS)
  first.unref()
  every.unref()
  return () => {
    clearTimeout(first)
    clearInterval(every)
  }
}
