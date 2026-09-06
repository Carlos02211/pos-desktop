import { mkdirSync } from 'fs'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { Server as SocketIOServer } from 'socket.io'
import { ValidationError, sendValidationError } from './lib/validate'
import { registerRoutes } from './routes'
import { initSocket } from './socket'

export interface ServerContext {
  /** Versión de la app (package.json / app.getVersion()). */
  version: string
  /** true en `electron-vite dev`. */
  isDev: boolean
  /** Ruta del archivo SQLite (para el respaldo al cerrar caja). */
  dbPath: string
  /** Carpeta de respaldo por defecto (si `config.backup_dir` está vacío). */
  backupDir: string
}

declare module 'fastify' {
  interface FastifyInstance {
    posContext: ServerContext
  }
}

export interface StartServerOptions extends ServerContext {
  host?: string
  port?: number
  /** Orígenes permitidos para CORS y Socket.io. `true` = cualquiera (sólo dev). */
  allowedOrigins?: string[] | true
  /** Carpeta servida en `/uploads/` (imágenes de producto y logo). */
  uploadsDir?: string
}

export interface RunningServer {
  app: FastifyInstance
  io: SocketIOServer
  url: string
  close: () => Promise<void>
}

const DEFAULT_PORT = 3001

/** Construye la instancia de Fastify con middleware y rutas, sin escuchar todavía. */
export async function buildServer(opts: StartServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.isDev ? 'info' : 'warn' }
  })

  app.decorate('posContext', {
    version: opts.version,
    isDev: opts.isDev,
    dbPath: opts.dbPath,
    backupDir: opts.backupDir
  })

  await app.register(cors, {
    origin: opts.allowedOrigins ?? true,
    credentials: true
  })

  if (opts.uploadsDir) {
    mkdirSync(opts.uploadsDir, { recursive: true })
    await app.register(fastifyStatic, {
      root: opts.uploadsDir,
      prefix: '/uploads/',
      decorateReply: false
    })
  }

  app.setErrorHandler((err: FastifyError, _request, reply) => {
    if (err instanceof ValidationError) return sendValidationError(reply, err)
    if (err.validation)
      return reply.code(400).send({ error: 'Datos inválidos', details: err.validation })
    const status = err.statusCode ?? 500
    if (status >= 500) app.log.error({ err }, 'Error no controlado')
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'Error interno del servidor' : err.message })
  })

  await registerRoutes(app)

  return app
}

/** Construye y arranca el servidor HTTP + Socket.io. */
export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? DEFAULT_PORT

  const app = await buildServer(opts)
  await app.listen({ host, port })

  const io = initSocket(app.server, opts.allowedOrigins ?? true)

  const url = `http://${host}:${port}`
  app.log.info(`POS SpArTaN Tech API escuchando en ${url}`)

  return {
    app,
    io,
    url,
    close: async () => {
      io.close()
      await app.close()
    }
  }
}
