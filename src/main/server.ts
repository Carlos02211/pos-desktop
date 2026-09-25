import { mkdirSync } from 'fs'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
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
  /** Carpeta servida en `/uploads/` (imágenes de producto y logo). */
  uploadsDir: string
  /**
   * Carpeta con el build estático del cliente React. Sólo en Fase 2 (servidor
   * standalone): las tabletas cargan la SPA desde el mismo origen que la API.
   * En Electron es `undefined` (el Renderer lo carga desde `file://`).
   */
  staticDir?: string
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
  /**
   * Si se pasa, el servidor habla HTTPS (Fase 2 sobre WiFi). PEM (contenido, no ruta).
   * `ca` = certificado PÚBLICO de la autoridad local (mkcert): se publica en `/ca.crt` para
   * que cada tableta lo descargue e instale como de confianza.
   */
  tls?: { key: string | Buffer; cert: string | Buffer; ca?: string | Buffer }
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
    logger: { level: opts.isDev ? 'info' : 'warn' },
    ...(opts.tls ? { https: { key: opts.tls.key, cert: opts.tls.cert }, trustProxy: false } : {})
  })

  app.decorate('posContext', {
    version: opts.version,
    isDev: opts.isDev,
    dbPath: opts.dbPath,
    backupDir: opts.backupDir,
    uploadsDir: opts.uploadsDir,
    staticDir: opts.staticDir
  })

  // Cabeceras de seguridad en todas las respuestas (no hace falta helmet para esto).
  const servingSpa = !!opts.staticDir
  // Para la SPA servida por el propio servidor (Fase 2), una CSP completa. En
  // Electron (sin staticDir) la CSP vive en el <meta> de index.html.
  const spaCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Tailwind / libs inyectan <style> en runtime
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'", // API + Socket.io del mismo origen
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ')

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header(
      'Content-Security-Policy',
      servingSpa ? spaCsp : "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
    )
    return payload
  })

  await app.register(cors, {
    // `[]` (Fase 2 sin POS_ALLOWED_ORIGINS) = sólo mismo origen. `true` = cualquiera (sólo dev).
    origin: opts.allowedOrigins ?? true,
    credentials: true
  })

  await app.register(multipart, {
    limits: { fileSize: 3 * 1024 * 1024, files: 1 }
  })

  mkdirSync(opts.uploadsDir, { recursive: true })
  await app.register(fastifyStatic, {
    root: opts.uploadsDir,
    prefix: '/uploads/',
    decorateReply: false
  })

  // CA local para instalar en las tabletas (es pública; la clave privada nunca sale del
  // servidor). Antes de instalarla el navegador avisa "no seguro": se acepta una vez.
  const caCert = opts.tls?.ca
  if (caCert) {
    app.get('/ca.crt', async (_request, reply) =>
      reply
        .type('application/x-x509-ca-cert')
        .header('content-disposition', 'attachment; filename="CA-POS-SpArTaN.crt"')
        .send(caCert)
    )
  }

  // Fase 2: sirve la SPA de React desde el propio servidor. Las rutas `/api/*`
  // y `/uploads/*` ya están registradas y tienen prioridad; el resto cae aquí,
  // y cualquier ruta no-API devuelve `index.html` (HashRouter en el cliente).
  if (opts.staticDir) {
    // Esta registración SÍ decora `reply` (con `sendFile`), la de `/uploads/` no.
    // wildcard (por defecto): cada archivo se busca en disco al pedirlo. Con
    // `wildcard: false` las rutas se fijaban al arrancar y, al actualizar `public/` sin
    // reiniciar, los bundles nuevos (otro hash) caían en index.html → pantalla en blanco.
    await app.register(fastifyStatic, {
      root: opts.staticDir,
      prefix: '/'
    })
    app.setNotFoundHandler((request, reply) => {
      const isSpaRoute =
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/uploads/') &&
        // Un bundle que no existe es un 404, no la SPA (si no, el navegador intenta
        // ejecutar index.html como JS y el error es incomprensible).
        !request.url.startsWith('/assets/')
      if (isSpaRoute) return reply.type('text/html').sendFile('index.html')
      return reply.code(404).send({ error: 'No encontrado' })
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

  const url = `${opts.tls ? 'https' : 'http'}://${host}:${port}`
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
