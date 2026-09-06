import type { FastifyInstance } from 'fastify'
import { authRoutes } from './auth'
import { licenseRoutes } from './license'
import { pingRoutes } from './ping'

/**
 * Registro central de rutas de la API.
 * Cada sprint añade su archivo de rutas aquí:
 *   Sprint 2 → productos.ts, categorias.ts, ventas.ts
 *   Sprint 3 → caja.ts
 *   Sprint 5 → usuarios.ts
 *   Sprint 6 → reportes.ts
 *   Sprint 7 → config.ts
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(pingRoutes)
  await app.register(licenseRoutes)
  await app.register(authRoutes)
}
