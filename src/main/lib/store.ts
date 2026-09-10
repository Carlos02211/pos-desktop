import crypto from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Almacenamiento local para datos que NO viven en la base de datos: el secreto de
 * firma de JWT y (en Fase 1) la licencia ligada al hardware.
 *
 * Dos backends:
 *  - `electron`: `electron-store` (cifrado con clave del binario — no es un secreto
 *    real, pero mantiene compatibilidad con instalaciones de Fase 1 ya activadas).
 *  - `file`: un `pos-config.json` en texto plano con permisos 600. Lo usa el
 *    servidor standalone de Fase 2 (el bundle NO trae la dependencia `electron`).
 *
 * `initStore` es async porque `electron-store` es ESM y se carga bajo demanda.
 */

export interface StoreSchema {
  license_key?: string
  license_fingerprint?: string
  license_activated_at?: number
  jwt_secret?: string
}

export interface KVStore {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K]
  set<K extends keyof StoreSchema>(key: K, value: NonNullable<StoreSchema[K]>): void
}

// Ofuscación en reposo (Fase 1). No protege frente a un atacante con el binario.
const ENCRYPTION_KEY = 'SPARTAN_TECH_2026_SECRET'

/** Store en un JSON plano. Escritura atómica (tmp + rename) y permisos 600. */
class JsonFileStore implements KVStore {
  private readonly path: string
  private data: StoreSchema = {}

  constructor(cwd: string) {
    this.path = join(cwd, 'pos-config.json')
    mkdirSync(dirname(this.path), { recursive: true })
    if (existsSync(this.path)) {
      try {
        this.data = JSON.parse(readFileSync(this.path, 'utf8')) as StoreSchema
      } catch {
        // No se borra en silencio: se avisa y se sigue con datos vacíos (el
        // jwt_secret se regenera; la licencia pediría reactivación).
        console.error(
          `[store] ${this.path} ilegible — se ignora. Restaurá el backup si tenías licencia.`
        )
      }
    }
  }

  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return this.data[key]
  }

  set<K extends keyof StoreSchema>(key: K, value: NonNullable<StoreSchema[K]>): void {
    this.data[key] = value
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.path)
    try {
      chmodSync(this.path, 0o600)
    } catch {
      /* Windows: chmod es no-op, ignorar */
    }
  }
}

let _store: KVStore | null = null

export async function initStore(cwd: string, kind: 'electron' | 'file' = 'file'): Promise<KVStore> {
  if (_store) return _store

  if (kind === 'electron') {
    const mod = (await import('electron-store')) as { default: new (o: unknown) => KVStore }
    const ElectronStore = (mod.default ?? mod) as new (o: unknown) => KVStore
    _store = new ElectronStore({
      cwd,
      name: 'pos-config',
      encryptionKey: ENCRYPTION_KEY,
      clearInvalidConfig: false
    })
  } else {
    _store = new JsonFileStore(cwd)
  }
  return _store
}

export function getStore(): KVStore {
  if (!_store) throw new Error('El store no ha sido inicializado. Llama initStore() primero.')
  return _store
}

/**
 * Secreto para firmar los JWT.
 *  - Si `JWT_SECRET` está en el entorno (≥32 chars) se usa ese.
 *  - Si no, se genera una vez y se persiste en el store.
 */
export function getJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
  if (fromEnv && fromEnv.length >= 32) return fromEnv

  const store = getStore()
  let secret = store.get('jwt_secret')
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex')
    store.set('jwt_secret', secret)
  }
  return secret
}
