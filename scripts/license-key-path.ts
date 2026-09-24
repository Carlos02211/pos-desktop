import { homedir } from 'os'
import { join } from 'path'

/** Ruta de la clave privada de licencias en la máquina del proveedor. */
export function privateKeyPath(): string {
  return (
    process.env.POS_LICENSE_PRIVATE_KEY_FILE ||
    join(homedir(), '.config', 'spartan-pos', 'license-private.pem')
  )
}
