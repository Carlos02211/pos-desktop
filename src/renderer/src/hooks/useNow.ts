import { useEffect, useState } from 'react'

/** Hora actual que se refresca cada `intervalMs` (reloj de la barra, duración del turno). */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
