/**
 * Freno de intentos fallidos en memoria, por clave (normalmente la IP, o `ip|usuario`).
 *
 * No pretende ser un rate-limiter completo — es una capa simple para que endpoints
 * sensibles (login, activación de licencia) no queden abiertos a intentos sin límite.
 * Al reiniciar el proceso se pierde el estado (aceptable). En Fase 2 detrás de un
 * proxy hay que configurar `trustProxy` para que `request.ip` sea el real.
 */
export interface ThrottleOptions {
  /** Intentos fallidos permitidos dentro de la ventana antes de bloquear. */
  max: number
  /** Duración de la ventana / del bloqueo, en ms. */
  windowMs: number
}

interface Entry {
  count: number
  resetAt: number
}

export class Throttle {
  private readonly attempts = new Map<string, Entry>()
  private lastSweep = 0

  constructor(private readonly opts: ThrottleOptions) {}

  /** true si la clave está bloqueada ahora mismo. */
  isBlocked(key: string): boolean {
    const entry = this.attempts.get(key)
    return !!entry && entry.count >= this.opts.max && Date.now() < entry.resetAt
  }

  /** Registra un intento fallido. */
  recordFailure(key: string): void {
    this.sweep()
    const now = Date.now()
    const entry = this.attempts.get(key)
    if (!entry || now >= entry.resetAt) {
      this.attempts.set(key, { count: 1, resetAt: now + this.opts.windowMs })
    } else {
      entry.count++
    }
  }

  /** Limpia el contador de una clave tras un intento exitoso. */
  clear(key: string): void {
    this.attempts.delete(key)
  }

  /** Purga entradas vencidas de vez en cuando para no acumular memoria. */
  private sweep(): void {
    const now = Date.now()
    if (now - this.lastSweep < this.opts.windowMs) return
    this.lastSweep = now
    for (const [key, entry] of this.attempts) {
      if (now >= entry.resetAt) this.attempts.delete(key)
    }
  }
}
