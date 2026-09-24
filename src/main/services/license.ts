import crypto from 'crypto'
import os from 'os'
import si from 'systeminformation'
import type { LicenseStatusResponse } from '../../shared/types'
import { getStore } from '../lib/store'

/**
 * Licencia offline ligada al hardware, firmada con Ed25519.
 *
 * Esquema:
 *  - `fingerprint` = SHA-256(uuid del sistema | MAC física | serie del disco | hostname)
 *  - `clave` = base32(firma Ed25519 de "spartan-pos-license-v1:<fingerprint>"), en grupos de 5
 *  - Activar = verificar la firma con la clave PÚBLICA embebida en el código.
 *    Sin servidor, sin conexión.
 *
 * La clave PRIVADA sólo existe en la máquina de SpArTaN Tech (ver `scripts/license-keygen.ts`)
 * y es la única que puede emitir licencias (`pnpm license:gen <fingerprint>`). La PC del
 * cliente sólo tiene la pública: aunque lea el `.env`, desarme el `.exe` o el `server.cjs`,
 * no puede fabricar una clave para otro equipo. (Lo que ningún esquema offline impide es
 * que alguien PARCHEE el binario para saltarse la verificación; esto evita la falsificación
 * de claves, no la ingeniería inversa.)
 *
 * `POS_LICENSE_PUBLIC_KEY` permite otra clave pública SÓLO al correr desde el código fuente
 * (tests, `verify:backend`). Los builds de producción (electron-vite y tsup) congelan esa
 * variable a "" en tiempo de compilación, así que en la PC del cliente se ignora.
 */

/** Clave pública de producción (Ed25519, `x` del JWK en base64url). No es secreta. */
export const PRODUCTION_PUBLIC_KEY = 'OtbdNH-s5xWaNdIW2NZGWKaL1sV9ZAl_IYXr3PJ12-I'

const PAYLOAD_PREFIX = 'spartan-pos-license-v1:'
const SIGNATURE_BYTES = 64
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = ((value << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(text: string): Buffer {
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of text) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) throw new Error('carácter base32 inválido')
    value = ((value << 5) | idx) & 0xffff
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Deja sólo los caracteres significativos para comparar claves sin importar guiones/espacios. */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '')
}

function formatKey(normalized: string): string {
  return normalized.match(/.{1,5}/g)!.join('-')
}

// Se lee en cada llamada (no al importar) para que los tests puedan fijar su propia clave.
function activePublicKey(): crypto.KeyObject {
  const x = process.env.POS_LICENSE_PUBLIC_KEY || PRODUCTION_PUBLIC_KEY
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' })
}

/** `x` (base64url) de la clave pública que corresponde a una privada. */
export function publicKeyOf(privateKey: crypto.KeyObject): string {
  return crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x!
}

/** true si esta instalación verifica con la clave pública de producción. */
export function usingProductionPublicKey(): boolean {
  return (
    !process.env.POS_LICENSE_PUBLIC_KEY ||
    process.env.POS_LICENSE_PUBLIC_KEY === PRODUCTION_PUBLIC_KEY
  )
}

/** Firma la licencia de un fingerprint. Sólo la usan el generador y los tests. */
export function signLicense(fingerprint: string, privateKey: crypto.KeyObject): string {
  const signature = crypto.sign(null, Buffer.from(PAYLOAD_PREFIX + fingerprint), privateKey)
  return formatKey(base32Encode(signature))
}

/** true si `key` es una firma válida de este fingerprint con la clave pública activa. */
export function verifyLicense(fingerprint: string, key: string): boolean {
  try {
    const signature = base32Decode(normalizeKey(key))
    if (signature.length !== SIGNATURE_BYTES) return false
    return crypto.verify(
      null,
      Buffer.from(PAYLOAD_PREFIX + fingerprint),
      activePublicKey(),
      signature
    )
  } catch {
    return false
  }
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

export async function getLicenseStatus(): Promise<LicenseStatusResponse> {
  const store = getStore()
  const fingerprint = await getHardwareFingerprint()
  const storedKey = store.get('license_key')
  const storedFingerprint = store.get('license_fingerprint')

  const active =
    !!storedKey && storedFingerprint === fingerprint && verifyLicense(fingerprint, storedKey)

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

  if (!verifyLicense(fingerprint, key)) {
    return { ok: false, error: 'La clave no es válida para este equipo.' }
  }

  const store = getStore()
  store.set('license_key', formatKey(normalizeKey(key)))
  store.set('license_fingerprint', fingerprint)
  store.set('license_activated_at', Math.floor(Date.now() / 1000))

  return { ok: true, status: await getLicenseStatus() }
}
