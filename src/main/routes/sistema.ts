import { basename } from 'path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type {
  BackupRunResponse,
  BackupStatus,
  FolderListing,
  SystemPrintersResponse
} from '../../shared/types'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import {
  checkWritable,
  getLastAttempt,
  listBackups,
  resolveBackupJob,
  runBackup
} from '../services/backup'
import { getConfigMap } from '../services/config'
import { createFolder, listFolder } from '../services/folders'
import { listSystemPrinters, printTestPage } from '../services/printer'

/**
 * Herramientas de administración que actúan sobre la PC del SERVIDOR: respaldos, elegir
 * carpetas y probar la impresora. Sólo ADMIN.
 */

const pathSchema = z.object({ path: z.string().max(400).optional() })
const createFolderSchema = z.object({
  parent: z.string().min(1).max(400),
  name: z.string().min(1).max(120)
})
const probeSchema = z.object({ path: z.string().min(1).max(400) })
const testPrintSchema = z.object({
  interface: z.string().max(200),
  /** Lo que se ve en pantalla aunque todavía no se haya guardado. */
  ticketLogo: z.boolean().optional()
})

/** Si el servidor corre como servicio de Windows, cómo darle permiso a una carpeta. */
function permissionHint(path: string): string {
  return process.platform === 'win32'
    ? ` En la PC servidor, PowerShell como Administrador: icacls "${path}" /grant "*S-1-5-19:(OI)(CI)M"`
    : ''
}

export async function sistemaRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: requireRole('ADMIN') }

  app.get('/api/admin/respaldos', admin, async (): Promise<BackupStatus> => {
    const { target, dir, isDefaultDir } = await resolveBackupJob(app.posContext)
    return {
      dir,
      isDefaultDir,
      engine: target.dialect,
      unsupported: target.databaseUrl?.startsWith('pglite://')
        ? 'La base de pruebas (PGlite) no admite respaldo.'
        : undefined,
      backups: listBackups(dir)
        .slice(0, 10)
        .map(({ name, sizeBytes, createdAt }) => ({ name, sizeBytes, createdAt })),
      lastAttempt: getLastAttempt()
    }
  })

  app.post('/api/admin/respaldos', admin, async (): Promise<BackupRunResponse> => {
    const { target, dir } = await resolveBackupJob(app.posContext)
    const r = await runBackup(target, dir)
    if (!r.ok) {
      const denied = /permiso/i.test(r.error ?? '')
      return {
        ok: false,
        error: (r.error ?? 'Error de respaldo') + (denied ? permissionHint(dir) : '')
      }
    }
    if (r.skipped) return { ok: true, skipped: r.skipped }
    const file = listBackups(dir).find((b) => b.path === r.path)
    return {
      ok: true,
      file: file
        ? { name: file.name, sizeBytes: file.sizeBytes, createdAt: file.createdAt }
        : { name: basename(r.path!), sizeBytes: r.sizeBytes ?? 0, createdAt: Date.now() / 1000 }
    }
  })

  app.get('/api/admin/carpetas', admin, async (request): Promise<FolderListing> => {
    const { path } = parse(pathSchema, request.query)
    return listFolder(path)
  })

  app.post('/api/admin/carpetas', admin, async (request, reply) => {
    const { parent, name } = parse(createFolderSchema, request.body)
    return reply.code(201).send({ path: createFolder(parent, name) })
  })

  // ¿El servidor puede escribir ahí? (Servicio local no tiene permiso en cualquier carpeta.)
  app.post('/api/admin/carpetas/probar', admin, async (request) => {
    const { path } = parse(probeSchema, request.body)
    const r = checkWritable(path)
    return r.ok ? r : { ok: false, error: r.error + permissionHint(path) }
  })

  app.get('/api/admin/impresoras', admin, async (): Promise<SystemPrintersResponse> => {
    if (process.platform !== 'win32') return { supported: false, printers: [] }
    try {
      return { supported: true, printers: await listSystemPrinters() }
    } catch (err) {
      return {
        supported: true,
        printers: [],
        error: err instanceof Error ? err.message : 'No se pudo leer la lista de impresoras.'
      }
    }
  })

  app.post('/api/admin/impresora/prueba', admin, async (request) => {
    const { interface: iface, ticketLogo } = parse(testPrintSchema, request.body)
    const config = await getConfigMap(getDb())
    if (ticketLogo !== undefined) config.ticket_logo = ticketLogo ? '1' : '0'
    return printTestPage(iface, config, app.posContext.uploadsDir)
  })
}
