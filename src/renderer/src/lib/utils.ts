import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Helper estándar de shadcn/ui para componer clases de Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * UUID v4 aleatorio. `crypto.randomUUID()` sólo existe en contextos seguros (HTTPS o
 * localhost): una tableta que entra por `http://192.168.x.x:3000` no la tiene. En cambio
 * `crypto.getRandomValues()` está disponible siempre.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
