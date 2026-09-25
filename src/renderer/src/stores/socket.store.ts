import { create } from 'zustand'
import { socket } from '@/lib/socket'
import { useAuthStore } from '@/stores/auth.store'

interface SocketState {
  connected: boolean
  /**
   * Se incrementa con cada evento de negocio (venta, apertura/cierre de caja).
   * Úsalo como dependencia de `useEffect` para refrescar datos en vivo.
   */
  revision: number
}

export const useSocketStore = create<SocketState>(() => ({
  connected: socket.connected,
  revision: 0
}))

const bump = (): void => useSocketStore.setState((s) => ({ revision: s.revision + 1 }))

socket.on('connect', () => useSocketStore.setState({ connected: true }))
socket.on('disconnect', () => useSocketStore.setState({ connected: false }))
socket.on('connect_error', (err) => {
  useSocketStore.setState({ connected: false })
  // El servidor rechazó el handshake (token vencido/ inválido) — cerrar sesión.
  if (err.message === 'unauthorized') useAuthStore.getState().clear()
})
socket.on('venta:nueva', bump)
socket.on('caja:apertura', bump)
socket.on('caja:cierre', bump)
socket.on('cuenta:abono', bump)

// Conecta el socket sólo mientras haya sesión iniciada.
useAuthStore.subscribe((state, prev) => {
  if (state.token && !prev.token) socket.connect()
  else if (!state.token && prev.token) socket.disconnect()
})
// Sesión restaurada tras una recarga: ya hay token al arrancar.
if (useAuthStore.getState().token) socket.connect()
