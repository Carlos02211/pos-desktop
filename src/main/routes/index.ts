import type { FastifyInstance } from 'fastify'
import { authRoutes } from './auth'
import { cajaRoutes } from './caja'
import { categoriasRoutes } from './categorias'
import { licenseRoutes } from './license'
import { pingRoutes } from './ping'
import { productosRoutes } from './productos'
import { ventasRoutes } from './ventas'

/**
 * Registro central de rutas de la API.
 * Cada sprint añade su archivo de rutas aquí:
 *   Sprint 5 → usuarios.ts, historial en ventas.ts / caja.ts
 *   Sprint 6 → reportes.ts
 *   Sprint 7 → config.ts
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(pingRoutes)
  await app.register(licenseRoutes)
  await app.register(authRoutes)
  await app.register(productosRoutes)
  await app.register(categoriasRoutes)
  await app.register(cajaRoutes)
  await app.register(ventasRoutes)
}
