import { create } from 'zustand'
import { socket } from '@/lib/socket'

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
socket.on('venta:nueva', bump)
socket.on('caja:apertura', bump)
socket.on('caja:cierre', bump)
