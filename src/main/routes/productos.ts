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
import { emit } from '../socket'
import {
  createProduct,
  deactivateProduct,
  getProduct,
  listActiveProducts,
  listProducts,
  setProductImage,
  updateProduct
} from '../services/productos'

const productSchema = z.object({
  name: z.string().min(1).max(120),
  price: z.number().nonnegative().max(1_000_000),
  unit: z.enum(['PIEZA', 'KG']).optional(),
  categoryId: z.number().int().positive().nullable(),
  active: z.boolean().optional()
})
const idParam = z.object({ id: z.coerce.number().int().positive() })

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
}

export async function productosRoutes(app: FastifyInstance): Promise<void> {
  // COBRADOR ve sólo activos; ADMIN puede pedir todos con ?all=1
  app.get('/api/productos', { preHandler: requireRole('COBRADOR') }, async (request) => {
    const all = (request.query as { all?: string }).all === '1'
    if (all && request.authUser!.role === 'ADMIN') return await listProducts(getDb(), true)
    return await listActiveProducts(getDb())
  })

  app.post('/api/productos', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const product = await createProduct(getDb(), parse(productSchema, request.body))
    emit('producto:update', { productId: product.id })
    return reply.code(201).send(product)
  })

  app.put('/api/productos/:id', { preHandler: requireRole('ADMIN') }, async (request) => {
    const { id } = parse(idParam, request.params)
    const product = await updateProduct(getDb(), id, parse(productSchema, request.body))
    emit('producto:update', { productId: id })
    return product
  })

  app.delete('/api/productos/:id', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
    const { id } = parse(idParam, request.params)
    await deactivateProduct(getDb(), id)
    emit('producto:update', { productId: id })
    return reply.code(204).send()
  })

  app.post(
    '/api/productos/:id/imagen',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { id } = parse(idParam, request.params)
      const db = getDb()
      const current = await getProduct(db, id)

      const data = await request.file()
      if (!data) throw new HttpError(400, 'No se recibió ningún archivo.')
      const ext = IMAGE_EXT[data.mimetype]
      if (!ext) throw new HttpError(400, 'Formato no soportado (usa PNG, JPG o WebP).')

      const dir = join(app.posContext.uploadsDir, 'productos')
      await mkdir(dir, { recursive: true })
      const filename = `${randomUUID()}${ext}`
      await pipeline(data.file, createWriteStream(join(dir, filename)))
      if (data.file.truncated) {
        await unlink(join(dir, filename)).catch(() => {})
        throw new HttpError(413, 'La imagen supera el tamaño máximo (3 MB).')
      }

      const relative = `productos/${filename}`
      const product = await setProductImage(db, id, relative)

      // Borra la imagen anterior si estaba dentro de nuestra carpeta.
      if (current.imagePath && current.imagePath.startsWith('productos/')) {
        await unlink(join(app.posContext.uploadsDir, current.imagePath)).catch(() => {})
      }

      emit('producto:update', { productId: id })
      return reply.code(201).send({ path: relative, product })
    }
  )
}
