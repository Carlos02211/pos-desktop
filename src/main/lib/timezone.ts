/**
 * Fechas del negocio sin depender del huso horario del PROCESO (pm2/Windows o un
 * contenedor pueden estar en UTC y desplazar "hoy", los cortes diarios y los
 * tramos horarios de los reportes).
 *
 * `config.business_utc_offset` = minutos respecto de UTC (ej. -360 para GMT-6).
 * Si no está configurado, se usa el offset del propio proceso — así el
 * comportamiento no cambia hasta que el negocio fije el suyo.
 */
import type { ConfigMap } from '../services/config'

export function businessOffsetMinutes(config: ConfigMap): number {
  const raw = config['business_utc_offset']
  const n = raw == null || raw === '' ? NaN : Number(raw)
  if (Number.isFinite(n) && Math.abs(n) <= 14 * 60) return n
  return -new Date().getTimezoneOffset()
}

export interface DateParts {
  year: number
  month: number // 0-11
  day: number
  hour: number
}

/** Descompone un timestamp Unix (segundos) en la fecha/hora LOCAL del negocio. */
export function partsFor(unixSeconds: number, offsetMinutes: number): DateParts {
  const shifted = new Date((unixSeconds + offsetMinutes * 60) * 1000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours()
  }
}

/** Fecha/hora local del negocio AHORA. */
export function nowParts(offsetMinutes: number): DateParts {
  return partsFor(Math.floor(Date.now() / 1000), offsetMinutes)
}

/** Segundos Unix del inicio (00:00) de ese día en la zona del negocio. */
export function dayStartUnix(
  year: number,
  month: number,
  day: number,
  offsetMinutes: number
): number {
  return Math.floor(Date.UTC(year, month, day) / 1000) - offsetMinutes * 60
}
