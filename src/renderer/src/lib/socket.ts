import { io } from 'socket.io-client'
import { API_BASE_URL } from '@/api/client'
import { getToken } from '@/stores/auth.store'

/**
 * Cliente Socket.io compartido. Los eventos son sólo notificaciones: al recibir
 * uno, el componente hace `fetch()` si necesita datos frescos.
 *
 * No conecta hasta que hay sesión: el servidor exige un JWT válido en el handshake
 * (ver `src/main/socket.ts`). `socket.store.ts` lo conecta/desconecta al hacer
 * login/logout. `auth` es una función → se reevalúa en cada reconexión con el token
 * vigente.
 */
export const socket = io(API_BASE_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: (cb) => cb({ token: getToken() ?? '' })
})
