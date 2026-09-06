import type { Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
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

  io.on('connection', (socket) => {
    // En Fase 2 aquí se autenticará el socket con el JWT y se unirá a salas por rol.
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
