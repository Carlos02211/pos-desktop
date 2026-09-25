/**
 * Generador de claves de licencia (uso interno de SpArTaN Tech).
 *
 *   pnpm license:gen <fingerprint>     genera la clave para ese fingerprint
 *   pnpm license:gen --here            usa el fingerprint de este equipo
 *
 * El cliente lee su fingerprint en la pantalla de activación de la app.
 *
 * Firma con la clave PRIVADA de `~/.config/spartan-pos/license-private.pem` (o la ruta de
 * `POS_LICENSE_PRIVATE_KEY_FILE`), creada una vez con `pnpm license:keygen`. Se niega a
 * firmar si esa privada no corresponde a la pública de producción embebida en el código:
 * la clave no serviría en la PC del cliente.
 */
import crypto from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { privateKeyPath } from './license-key-path'
import {
  getHardwareFingerprint,
  PRODUCTION_PUBLIC_KEY,
  publicKeyOf,
  signLicense
} from '../src/main/services/license'

async function main(): Promise<void> {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Uso: pnpm license:gen <fingerprint> | --here')
    process.exitCode = 1
    return
  }

  const fingerprint = arg === '--here' ? await getHardwareFingerprint() : arg.trim().toLowerCase()

  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    console.error('El fingerprint debe ser un SHA-256 en hexadecimal (64 caracteres).')
    process.exitCode = 1
    return
  }

  const path = privateKeyPath()
  if (!existsSync(path)) {
    console.error(`No existe la clave privada ${path}. Creala una vez con: pnpm license:keygen`)
    process.exitCode = 1
    return
  }
  const privateKey = crypto.createPrivateKey(readFileSync(path))

  if (publicKeyOf(privateKey) !== PRODUCTION_PUBLIC_KEY) {
    console.error(
      `La clave privada ${path} no corresponde a PRODUCTION_PUBLIC_KEY ` +
        '(src/main/services/license.ts) — las licencias que firme no servirían.'
    )
    process.exitCode = 1
    return
  }

  console.log('Fingerprint:', fingerprint)
  console.log('Clave:      ', signLicense(fingerprint, privateKey))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
