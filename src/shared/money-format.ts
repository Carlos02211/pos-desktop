/**
 * Importe como se lee en México: separador de miles y 2 decimales ("$2,578.75").
 * Negativos con signo menos al frente ("−$5.75"). Lo usan pantallas, tickets y reportes.
 */
export function formatMoney(amount: number, symbol = '$'): string {
  const negative = amount < 0 && Math.abs(amount) >= 0.005
  const [int, dec] = Math.abs(amount).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '−' : ''}${symbol}${grouped}.${dec}`
}
