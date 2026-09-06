import { io } from 'socket.io-client'
import { API_BASE_URL } from '@/api/client'

/**
 * Cliente Socket.io compartido. Los eventos son sólo notificaciones: al recibir
 * uno, el componente hace `fetch()` si necesita datos frescos.
 *
 * Fase 2: sólo cambia `API_BASE_URL`; el código de suscripción no cambia.
 */
export const socket = io(API_BASE_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling']
})
