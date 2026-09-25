import type { FastifyInstance } from 'fastify'
import { authRoutes } from './auth'
import { cajaRoutes } from './caja'
import { categoriasRoutes } from './categorias'
import { clientesRoutes } from './clientes'
import { configRoutes } from './config'
import { cuentasRoutes } from './cuentas'
import { dashboardRoutes } from './dashboard'
import { licenseRoutes } from './license'
import { pingRoutes } from './ping'
import { productosRoutes } from './productos'
import { reportesRoutes } from './reportes'
import { sistemaRoutes } from './sistema'
import { usuariosRoutes } from './usuarios'
import { ventasRoutes } from './ventas'

/** Registro central de rutas de la API. */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(pingRoutes)
  await app.register(licenseRoutes)
  await app.register(authRoutes)
  await app.register(usuariosRoutes)
  await app.register(productosRoutes)
  await app.register(categoriasRoutes)
  await app.register(clientesRoutes)
  await app.register(cajaRoutes)
  await app.register(ventasRoutes)
  await app.register(cuentasRoutes)
  await app.register(reportesRoutes)
  await app.register(configRoutes)
  await app.register(dashboardRoutes)
  await app.register(sistemaRoutes)
}
