import type { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import type { AuthUser } from '../shared/types'
import { verifyToken } from './lib/jwt'
import type { EventPayloads } from './socket-events'

let _io: SocketIOServer | null = null

/** Crea el servidor Socket.io sobre el mismo servidor HTTP de Fastify. */
export function initSocket(
  httpServer: HttpServer,
  allowedOrigins: string[] | true
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: allowedOrigins, credentials: true }
  })

  // Handshake autenticado: sin un JWT válido no se recibe ningún evento de negocio.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('unauthorized'))
      return
    }
    try {
      const user = verifyToken(token)
      ;(socket.data as { user?: AuthUser }).user = user
      // Salas por rol — permite dirigir eventos sensibles sólo a ADMIN más adelante.
      socket.join(`role:${user.role}`)
      next()
    } catch {
      next(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('disconnect', () => {})
  })

  _io = io
  return io
}

export function getIo(): SocketIOServer | null {
  return _io
}

/**
 * Emite un evento a todos los clientes conectados.
 * Los eventos son notificaciones, no comandos: el cliente hace fetch si necesita datos.
 */
export function emit<K extends keyof EventPayloads>(event: K, payload: EventPayloads[K]): void {
  _io?.emit(event, payload)
}

export function closeSocket(): void {
  _io?.close()
  _io = null
}
