/**
 * Generador de claves de licencia (uso interno de SpArTaN Tech).
 *
 *   pnpm license:gen <fingerprint>     genera la clave para ese fingerprint
 *   pnpm license:gen --here            usa el fingerprint de este equipo
 *
 * El cliente lee su fingerprint en la pantalla de activación de la app.
 * Debe usarse el mismo POS_VENDOR_SECRET que la app en producción.
 */
import { expectedKeyForFingerprint, getHardwareFingerprint } from '../src/main/services/license'

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

  console.log('Fingerprint:', fingerprint)
  console.log('Clave:      ', expectedKeyForFingerprint(fingerprint))
}

main()
