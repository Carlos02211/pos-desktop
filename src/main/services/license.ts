import crypto from 'crypto'
import os from 'os'
import si from 'systeminformation'
import type { LicenseStatusResponse } from '../../shared/types'
import { getStore } from '../lib/store'

/**
 * Licencia offline ligada al hardware.
 *
 * Esquema:
 *  - `fingerprint` = SHA-256(uuid del sistema | MAC física | serie del disco | hostname)
 *  - `clave` = base32(HMAC-SHA256(fingerprint, VENDOR_SECRET))[:25], en grupos de 5
 *  - Activar = comprobar que la clave introducida coincide con la esperada para
 *    este fingerprint. Sin servidor, sin conexión.
 *
 * SpArTaN Tech genera la clave de cada equipo con `pnpm license:gen <fingerprint>`.
 * Para revocar en remoto (Fase 2) se añadiría un ping al servidor de activación.
 *
 * IMPORTANTE — `VENDOR_SECRET` es lo único que sostiene la seguridad de este esquema:
 * quien lo tenga puede generar una clave válida para cualquier equipo. El fallback de
 * abajo es SÓLO para desarrollo/tests locales (`pnpm dev`, `pnpm verify:backend`) —
 * un build de producción (`pnpm build`/`build:win`) DEBE compilarse con `POS_VENDOR_SECRET`
 * real puesto en el entorno, que `electron.vite.config.ts` inyecta al bundle en tiempo de
 * compilación (el `.exe` final no depende de variables de entorno en la PC del cliente).
 * `scripts/check-vendor-secret.ts` corta el build si falta.
 */

const DEV_ONLY_SECRET = 'DEV-ONLY-INSECURE-SECRET-NUNCA-USAR-EN-PRODUCCION'
// Valores que circularon como público/de ejemplo en algún momento (git history, .env.example
// viejo) — tratarlos igual que "no configurado" para que nadie los deje puestos sin darse cuenta.
// Exportado para que `scripts/check-vendor-secret.ts` rechace los mismos valores al compilar.
export const KNOWN_LEAKED_SECRETS = new Set([
  'SPARTAN-TECH-VENDOR-SECRET-2026',
  'CAMBIAR-genera-el-tuyo-con-openssl-rand--base64-32'
])

const VENDOR_SECRET =
  process.env.POS_VENDOR_SECRET && !KNOWN_LEAKED_SECRETS.has(process.env.POS_VENDOR_SECRET)
    ? process.env.POS_VENDOR_SECRET
    : DEV_ONLY_SECRET

/**
 * true si el secreto activo es el de desarrollo (no se configuró uno propio, o el
 * configurado es un valor público/filtrado conocido). Un servidor de producción NO
 * debe arrancar en este estado — ver `src/server/index.ts`.
 */
export const usingInsecureVendorSecret = VENDOR_SECRET === DEV_ONLY_SECRET

if (usingInsecureVendorSecret) {
  console.warn(
    '[license] POS_VENDOR_SECRET no definido, o es un valor público/de ejemplo conocido — ' +
      'usando el secreto de desarrollo (inseguro). Un build de producción sin un valor real ' +
      'propio emite licencias que cualquiera puede falsificar.'
  )
}
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return output
}

/** Deja sólo los caracteres significativos para comparar claves sin importar guiones/espacios. */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '')
}

/** Compara en tiempo constante — evita filtrar por temporización cuánto de la clave acertó. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

// El hardware no cambia durante la sesión; `systeminformation` es lento (procesos
// del sistema), así que cacheamos el fingerprint tras el primer cálculo.
let cachedFingerprint: string | null = null

export async function getHardwareFingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint

  const [system, uuid, nets, disks] = await Promise.all([
    si.system(),
    si.uuid(),
    si.networkInterfaces(),
    si.diskLayout()
  ])

  const interfaces = Array.isArray(nets) ? nets : [nets]
  const primaryMac = interfaces.find(
    (n) => !n.virtual && n.mac && n.mac !== '00:00:00:00:00:00'
  )?.mac

  const parts = [
    system.uuid || uuid.hardware || uuid.os,
    primaryMac ?? '',
    disks[0]?.serialNum ?? '',
    os.hostname()
  ].filter(Boolean)

  cachedFingerprint = crypto.createHash('sha256').update(parts.join('|')).digest('hex')
  return cachedFingerprint
}

/** Clave de activación esperada para un fingerprint. Usada al activar y por el generador. */
export function expectedKeyForFingerprint(fingerprint: string): string {
  const mac = crypto.createHmac('sha256', VENDOR_SECRET).update(fingerprint).digest()
  const raw = base32(mac).slice(0, 25)
  return raw.match(/.{1,5}/g)!.join('-')
}

export async function getLicenseStatus(): Promise<LicenseStatusResponse> {
  const store = getStore()
  const fingerprint = await getHardwareFingerprint()
  const storedKey = store.get('license_key')
  const storedFingerprint = store.get('license_fingerprint')

  const active =
    !!storedKey &&
    storedFingerprint === fingerprint &&
    safeEqual(normalizeKey(storedKey), normalizeKey(expectedKeyForFingerprint(fingerprint)))

  return {
    active,
    fingerprint,
    activatedAt: active ? (store.get('license_activated_at') ?? null) : null
  }
}

export async function activateLicense(
  key: string
): Promise<{ ok: true; status: LicenseStatusResponse } | { ok: false; error: string }> {
  const fingerprint = await getHardwareFingerprint()

  if (!safeEqual(normalizeKey(key), normalizeKey(expectedKeyForFingerprint(fingerprint)))) {
    return { ok: false, error: 'La clave no es válida para este equipo.' }
  }

  const store = getStore()
  store.set('license_key', key.trim().toUpperCase())
  store.set('license_fingerprint', fingerprint)
  store.set('license_activated_at', Math.floor(Date.now() / 1000))

  return { ok: true, status: await getLicenseStatus() }
}
