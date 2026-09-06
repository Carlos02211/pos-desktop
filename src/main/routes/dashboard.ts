import type { FastifyInstance } from 'fastify'
import { getDb } from '../db'
import { requireRole } from '../middleware/auth'
import { getDashboard } from '../services/dashboard'

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dashboard', { preHandler: requireRole('ADMIN') }, async () => getDashboard(getDb()))
}
