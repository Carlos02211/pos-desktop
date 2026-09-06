/** Formatea un importe con símbolo de moneda (por defecto `$`, configurable en Sprint 7). */
export function money(amount: number, symbol = '$'): string {
  return `${symbol}${amount.toFixed(2)}`
}
