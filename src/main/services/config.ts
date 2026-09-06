import type { DB } from '../db'
import { config } from '../db/schema'

export type ConfigMap = Record<string, string>

/** Toda la configuración del negocio como un mapa `clave -> valor`. */
export function getConfigMap(db: DB): ConfigMap {
  const rows = db.select().from(config).all()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
