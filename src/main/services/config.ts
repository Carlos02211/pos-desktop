import type { ConfigInput, ConfigResponse } from '../../shared/types'
import type { DB } from '../db'
import { config } from '../db/schema'

export type ConfigMap = Record<string, string>

const DEFAULTS: ConfigResponse = {
  business_name: 'Mi Negocio',
  business_address: '',
  business_phone: '',
  logo_path: '',
  ticket_footer: '¡Gracias por su compra!',
  currency_symbol: '$',
  printer_interface: '',
  backup_dir: ''
}

/** Claves que `PUT /api/config` puede modificar (el logo va por su propio endpoint). */
export const EDITABLE_KEYS = Object.keys(DEFAULTS).filter((k) => k !== 'logo_path') as Array<
  keyof ConfigInput
>

/** Toda la configuración del negocio como un mapa `clave -> valor`. */
export function getConfigMap(db: DB): ConfigMap {
  const rows = db.select().from(config).all()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** Configuración completa con los valores por defecto rellenados. */
export function getConfig(db: DB): ConfigResponse {
  return { ...DEFAULTS, ...getConfigMap(db) }
}

function setKey(db: DB, key: string, value: string): void {
  db.insert(config)
    .values({ key, value })
    .onConflictDoUpdate({ target: config.key, set: { value } })
    .run()
}

export function updateConfig(db: DB, input: ConfigInput): ConfigResponse {
  for (const key of EDITABLE_KEYS) {
    const value = input[key]
    if (value !== undefined) setKey(db, key, String(value))
  }
  return getConfig(db)
}

export function setLogoPath(db: DB, relativePath: string): void {
  setKey(db, 'logo_path', relativePath)
}
