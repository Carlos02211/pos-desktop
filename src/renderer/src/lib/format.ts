/** Formatea un importe con símbolo de moneda (por defecto `$`, configurable en Sprint 7). */
export function money(amount: number, symbol = '$'): string {
  return `${symbol}${amount.toFixed(2)}`
}

/** Fecha y hora legible a partir de un timestamp Unix en segundos. */
export function dateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Solo la hora (para listados densos). */
export function timeOnly(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Convierte un `<input type="date">` (YYYY-MM-DD) a timestamp Unix (inicio/fin del día local). */
export function dateInputToUnix(value: string, endOfDay = false): number | undefined {
  if (!value) return undefined
  const d = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? undefined : Math.floor(d.getTime() / 1000)
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia'
}
export function paymentLabel(method: string): string {
  return METHOD_LABEL[method] ?? method
}
