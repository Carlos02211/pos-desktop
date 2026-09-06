import { createWriteStream } from 'fs'
import { mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { HttpError } from '../lib/http-error'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { getConfig, setLogoPath, updateConfig } from '../services/config'

const configSchema = z.object({
  business_name: z.string().max(120).optional(),
  business_address: z.string().max(200).optional(),
  business_phone: z.string().max(40).optional(),
  ticket_footer: z.string().max(200).optional(),
  currency_symbol: z.string().max(4).optional(),
  printer_interface: z.string().max(200).optional(),
  backup_dir: z.string().max(400).optional()
})

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', { preHandler: requireRole('ADMIN') }, async () => await getConfig(getDb()))

  app.put('/api/config', { preHandler: requireRole('ADMIN') }, async (request) => {
    return updateConfig(getDb(), parse(configSchema, request.body))
  })

  app.post('/api/config/logo', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const db = getDb()
    const data = await request.file()
    if (!data) throw new HttpError(400, 'No se recibió ningún archivo.')
    const ext = IMAGE_EXT[data.mimetype]
    if (!ext) throw new HttpError(400, 'Formato no soportado (usa PNG, JPG o WebP).')

    const dir = join(app.posContext.uploadsDir, 'config')
    await mkdir(dir, { recursive: true })
    const filename = `logo-${randomUUID()}${ext}`
    await pipeline(data.file, createWriteStream(join(dir, filename)))
    if (data.file.truncated) {
      await unlink(join(dir, filename)).catch(() => {})
      throw new HttpError(413, 'La imagen supera el tamaño máximo (3 MB).')
    }

    const previous = (await getConfig(db)).logo_path
    const relative = `config/${filename}`
    await setLogoPath(db, relative)
    if (previous && previous.startsWith('config/')) {
      await unlink(join(app.posContext.uploadsDir, previous)).catch(() => {})
    }

    return reply.code(201).send({ path: relative, config: await getConfig(db) })
  })
}
