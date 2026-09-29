import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { HttpError } from '../lib/http-error'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import { getCatalog, listCatalogs } from '../services/catalogos'
import {
  buildImportTemplate,
  importProducts,
  MAX_IMPORT_ROWS,
  parseProductSheet
} from '../services/importar'

// Laxo a propósito: cada renglón se revisa en el servicio y, si algo no cuadra, se salta
// con su motivo en vez de rechazar toda la lista.
const itemSchema = z.object({
  name: z.string().max(500),
  price: z.number(),
  unit: z.enum(['PIEZA', 'KG']),
  category: z.string().max(200).nullable(),
  barcode: z.string().max(200).nullable()
})
const importSchema = z.object({
  items: z.array(itemSchema).min(1).max(MAX_IMPORT_ROWS),
  dryRun: z.boolean().optional()
})
const catalogParam = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/) })

export async function importarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/productos/plantilla', { preHandler: requireRole('ADMIN') }, async (_req, reply) =>
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="plantilla-productos.xlsx"')
      .send(await buildImportTemplate())
  )

  /** Lee un Excel/CSV y devuelve los renglones interpretados (no guarda nada). */
  app.post(
    '/api/productos/importar/leer',
    { preHandler: requireRole('ADMIN') },
    async (request) => {
      const data = await request.file()
      if (!data) throw new HttpError(400, 'No se recibió ningún archivo.')
      const buffer = await data.toBuffer()
      if (data.file.truncated)
        throw new HttpError(413, 'El archivo supera el tamaño máximo (3 MB).')
      return { rows: await parseProductSheet(buffer) }
    }
  )

  app.post(
    '/api/productos/importar',
    // 5000 productos ≈ 1 MB de JSON: el límite por defecto de Fastify se queda corto.
    { preHandler: requireRole('ADMIN'), bodyLimit: 4 * 1024 * 1024 },
    async (request) => {
      const { items, dryRun } = parse(importSchema, request.body)
      const result = await importProducts(getDb(), items, dryRun === true)
      if (!dryRun && result.created > 0) emit('producto:update', { productId: 0 })
      return result
    }
  )

  app.get('/api/catalogos', { preHandler: requireRole('ADMIN') }, async () => listCatalogs())

  app.get('/api/catalogos/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(catalogParam, request.params)
    return getCatalog(id)
  })
}
