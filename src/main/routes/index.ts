import type { FastifyInstance } from 'fastify'
import { authRoutes } from './auth'
import { cajaRoutes } from './caja'
import { licenseRoutes } from './license'
import { pingRoutes } from './ping'
import { catalogRoutes } from './productos'
import { ventasRoutes } from './ventas'

/**
 * Registro central de rutas de la API.
 * Cada sprint añade su archivo de rutas aquí:
 *   Sprint 3 → cierre de caja en caja.ts, reimpresión en ventas.ts
 *   Sprint 4 → CRUD en productos.ts / categorias.ts
 *   Sprint 5 → usuarios.ts
 *   Sprint 6 → reportes.ts
 *   Sprint 7 → config.ts
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(pingRoutes)
  await app.register(licenseRoutes)
  await app.register(authRoutes)
  await app.register(catalogRoutes)
  await app.register(cajaRoutes)
  await app.register(ventasRoutes)
}
