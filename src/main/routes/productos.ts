import { asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { getDb } from '../db'
import { categories } from '../db/schema'
import { requireRole } from '../middleware/auth'
import { listActiveProducts } from '../services/productos'

/**
 * Lectura de catálogo para el panel del cobrador.
 * El CRUD completo (con imágenes) llega en Sprint 4 — panel de administración.
 */
export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/productos', { preHandler: requireRole('COBRADOR') }, async () =>
    listActiveProducts(getDb())
  )

  app.get('/api/categorias', { preHandler: requireRole('COBRADOR') }, async () =>
    getDb()
      .select()
      .from(categories)
      .where(eq(categories.active, 1))
      .orderBy(asc(categories.name))
      .all()
  )
}
