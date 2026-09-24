/**
 * Genera el par de claves Ed25519 de licencias (uso interno de SpArTaN Tech). UNA sola vez.
 *
 *   pnpm license:keygen
 *
 * - Guarda la clave PRIVADA en `~/.config/spartan-pos/license-private.pem` (permisos 600),
 *   o en `POS_LICENSE_PRIVATE_KEY_FILE` si está definida. Nunca va al repo.
 * - Imprime la clave PÚBLICA: pegarla en `PRODUCTION_PUBLIC_KEY`
 *   (`src/main/services/license.ts`) y commitearla — no es secreta.
 *
 * Respaldá el .pem (gestor de contraseñas / USB cifrado). Si se pierde, no se pueden emitir
 * licencias nuevas para los builds ya instalados. Si se filtra, hay que generar otro par,
 * publicar un build nuevo y re-licenciar a todos los clientes.
 */
import crypto from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { privateKeyPath } from './license-key-path'
import { publicKeyOf } from '../src/main/services/license'

const path = privateKeyPath()
if (existsSync(path)) {
  console.error(`Ya existe ${path} — no se sobrescribe (invalidaría todas las licencias).`)
  process.exit(1)
}

const { privateKey } = crypto.generateKeyPairSync('ed25519')
mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })

console.log(`Clave privada guardada en: ${path}  (respaldala; nunca la subas al repo)`)
console.log(`Clave pública (PRODUCTION_PUBLIC_KEY): ${publicKeyOf(privateKey)}`)
