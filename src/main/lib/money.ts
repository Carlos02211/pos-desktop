/** Redondea a 2 decimales evitando el error binario de coma flotante. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Redondea a 3 decimales (precisión de 1 gramo) para cantidades vendidas por kg. */
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
