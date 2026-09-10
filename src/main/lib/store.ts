import crypto from 'crypto'
import ElectronStore from 'electron-store'

/**
 * Almacenamiento local cifrado (electron-store) para datos que NO viven en la
 * base de datos: la licencia ligada al hardware y el secreto de firma de JWT.
 *
 * Se inicializa con un `cwd` explícito (no depende de `app.getPath`) para poder
 * usarse también fuera de Electron (script de verificación).
 */

// electron-store es ESM-only. Según cómo se resuelva (bundle CJS de electron-vite
// vs. ESM del script de verificación) el import puede llegar como la clase o como
// `{ default: clase }`. Normalizamos.
const Store = ((ElectronStore as { default?: typeof ElectronStore }).default ??
  ElectronStore) as typeof ElectronStore

type ConfigStore = ElectronStore<StoreSchema>

interface StoreSchema {
  license_key?: string
  license_fingerprint?: string
  license_activated_at?: number
  jwt_secret?: string
}

// Ofuscación en reposo del archivo de configuración. No es un secreto real:
// protege frente a edición casual, no frente a un atacante con el binario.
const ENCRYPTION_KEY = 'SPARTAN_TECH_2026_SECRET'

let _store: ConfigStore | null = null

export function initStore(cwd: string): ConfigStore {
  if (_store) return _store
  _store = new Store<StoreSchema>({
    cwd,
    name: 'pos-config',
    encryptionKey: ENCRYPTION_KEY,
    // `false`: si el archivo se corrompe (corte de luz a mitad de escritura) NO
    // se borra en silencio — perderíamos el jwt_secret (invalida sesiones) y la
    // licencia. Mejor que el arranque falle ruidosamente y se restaure el backup.
    clearInvalidConfig: false
  })
  return _store
}

export function getStore(): ConfigStore {
  if (!_store) throw new Error('El store no ha sido inicializado. Llama initStore() primero.')
  return _store
}

/**
 * Secreto para firmar los JWT.
 *
 * - Servidor Fase 2: si `JWT_SECRET` está en el entorno, se usa ese (no depende
 *   de que `POS_DATA_DIR` persista, y no queda cifrado con una clave del binario).
 * - Electron / dev: se genera una vez por instalación y se persiste en el store.
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
