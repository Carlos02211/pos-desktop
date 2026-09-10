import { mkdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { HttpError } from '../lib/http-error'
import { extForImage, sniffImage } from '../lib/image-type'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { getConfig, setLogoPath, updateConfig } from '../services/config'

const configSchema = z.object({
  business_name: z.string().max(120).optional(),
  business_address: z.string().max(200).optional(),
  business_phone: z.string().max(40).optional(),
  ticket_footer: z.string().max(200).optional(),
  currency_symbol: z.string().max(4).optional(),
  business_utc_offset: z
    .string()
    .max(6)
    .refine((s) => s === '' || (Number.isFinite(Number(s)) && Math.abs(Number(s)) <= 840), {
      message: 'Offset UTC inválido (minutos, entre -840 y 840, o vacío).'
    })
    .optional(),
  printer_interface: z.string().max(200).optional(),
  backup_dir: z.string().max(400).optional()
})

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', { preHandler: requireRole('ADMIN') }, async () => await getConfig(getDb()))

  app.put('/api/config', { preHandler: requireRole('ADMIN') }, async (request) => {
    return updateConfig(getDb(), parse(configSchema, request.body))
  })

  app.post('/api/config/logo', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const db = getDb()
    const data = await request.file()
    if (!data) throw new HttpError(400, 'No se recibió ningún archivo.')
    const buffer = await data.toBuffer()
    if (data.file.truncated) {
      throw new HttpError(413, 'La imagen supera el tamaño máximo (3 MB).')
    }
    const kind = sniffImage(buffer)
    if (!kind) throw new HttpError(400, 'El archivo no es una imagen PNG, JPG o WebP válida.')

    const dir = join(app.posContext.uploadsDir, 'config')
    await mkdir(dir, { recursive: true })
    const filename = `logo-${randomUUID()}${extForImage(kind)}`
    await writeFile(join(dir, filename), buffer)

    const previous = (await getConfig(db)).logo_path
    const relative = `config/${filename}`
    await setLogoPath(db, relative)
    if (previous && previous.startsWith('config/')) {
      await unlink(join(app.posContext.uploadsDir, previous)).catch(() => {})
    }

    return reply.code(201).send({ path: relative, config: await getConfig(db) })
  })
}
