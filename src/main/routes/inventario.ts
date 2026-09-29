import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDb } from '../db'
import { parse } from '../lib/validate'
import { requireRole } from '../middleware/auth'
import { emit } from '../socket'
import {
  addStockEntry,
  adjustStock,
  enableTracking,
  listInventory,
  listMovements
} from '../services/inventario'

const idParam = z.object({ id: z.coerce.number().int().positive() })
const entrySchema = z.object({
  quantity: z.number().positive().max(1_000_000),
  reason: z.string().trim().max(120).optional()
})
const adjustSchema = z.object({
  counted: z.number().nonnegative().max(1_000_000),
  reason: z.string().trim().max(120).optional()
})
const enableSchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1).max(10_000)
})

/** Inventario: sólo el administrador ve y mueve existencias. */
export async function inventarioRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: requireRole('ADMIN') }

  app.get('/api/inventario', admin, async () => listInventory(getDb()))

  app.get('/api/inventario/:id/movimientos', admin, async (request) => {
    const { id } = parse(idParam, request.params)
    return listMovements(getDb(), id)
  })

  app.post('/api/inventario/:id/entrada', admin, async (request) => {
    const { id } = parse(idParam, request.params)
    const item = await addStockEntry(
      getDb(),
      request.authUser!.id,
      id,
      parse(entrySchema, request.body)
    )
    emit('stock:update', { productId: id })
    return item
  })

  app.post('/api/inventario/:id/ajuste', admin, async (request) => {
    const { id } = parse(idParam, request.params)
    const item = await adjustStock(
      getDb(),
      request.authUser!.id,
      id,
      parse(adjustSchema, request.body)
    )
    emit('stock:update', { productId: id })
    return item
  })

  app.post('/api/inventario/activar', admin, async (request) => {
    const { productIds } = parse(enableSchema, request.body)
    const enabled = await enableTracking(getDb(), productIds)
    if (enabled > 0) emit('stock:update', { productId: null })
    return { enabled }
  })
}
