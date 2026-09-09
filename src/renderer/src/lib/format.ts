/** Formatea un importe con símbolo de moneda (por defecto `$`, configurable en Sprint 7). */
export function money(amount: number, symbol = '$'): string {
  return `${symbol}${amount.toFixed(2)}`
}

/** Cantidad legible: piezas enteras tal cual, kg en gramos si es menos de 1 kg. */
export function formatQty(quantity: number, unit: 'PIEZA' | 'KG'): string {
  if (unit !== 'KG') return String(quantity)
  if (quantity < 1) return `${Math.round(quantity * 1000)} g`
  return `${quantity.toFixed(3).replace(/\.?0+$/, '')} kg`
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

/** Fecha local en formato YYYY-MM-DD (para `<input type="date">` y filtros). */
export function localDateISO(d: Date = new Date()): string {
  return d.toLocaleDateString('sv-SE') // sv-SE => "2026-09-05"
}

/** Mes local en formato YYYY-MM (para `<input type="month">`). */
export function localMonthISO(d: Date = new Date()): string {
  return localDateISO(d).slice(0, 7)
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
