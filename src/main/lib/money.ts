/**
 * El dinero se guarda y se opera SIEMPRE como enteros de centavos (integer en la
 * base de datos) — nunca como coma flotante. Así las sumas (`SUM()` en SQL,
 * arqueos de caja, saldos de cuentas) son exactas y `a >= b` no falla por
 * redondeo. La conversión a/desde pesos decimales ocurre sólo en el borde HTTP.
 */

/** Pesos decimales (lo que teclea el cajero / llega en el body) → centavos enteros. */
export function toCents(pesos: number): number {
  return Math.round((pesos + Number.EPSILON * Math.sign(pesos || 1)) * 100)
}

/** Centavos enteros → pesos decimales (para las respuestas de la API y el ticket). */
export function fromCents(cents: number): number {
  return cents / 100
}

/** Redondea a 3 decimales (precisión de 1 gramo) para cantidades vendidas por kg. */
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

/** Redondea pesos a 2 decimales — sólo para limpiar ruido de coma flotante al
 *  operar en pesos (p. ej. armar el payload de un evento). El almacenamiento y
 *  la aritmética de negocio van en centavos. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Multiplica un precio en centavos por una cantidad (posiblemente fraccional, kg) → centavos. */
export function lineCents(priceCents: number, quantity: number): number {
  return Math.round(priceCents * quantity)
}
