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
  business_utc_offset: '',
  printer_interface: '',
  backup_dir: ''
}

/** Claves que `PUT /api/config` puede modificar (el logo va por su propio endpoint). */
export const EDITABLE_KEYS = Object.keys(DEFAULTS).filter((k) => k !== 'logo_path') as Array<
  keyof ConfigInput
>

/** Toda la configuración del negocio como un mapa `clave -> valor`. */
export async function getConfigMap(db: DB): Promise<ConfigMap> {
  const rows = await db.select().from(config)
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** Configuración completa con los valores por defecto rellenados. */
export async function getConfig(db: DB): Promise<ConfigResponse> {
  return { ...DEFAULTS, ...(await getConfigMap(db)) }
}

async function setKey(db: DB, key: string, value: string): Promise<void> {
  await db
    .insert(config)
    .values({ key, value })
    .onConflictDoUpdate({ target: config.key, set: { value } })
}

export async function updateConfig(db: DB, input: ConfigInput): Promise<ConfigResponse> {
  for (const key of EDITABLE_KEYS) {
    const value = input[key]
    if (value !== undefined) await setKey(db, key, String(value))
  }
  return getConfig(db)
}

export async function setLogoPath(db: DB, relativePath: string): Promise<void> {
  await setKey(db, 'logo_path', relativePath)
}
