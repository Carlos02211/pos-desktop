/**
 * Corta el build de producción (`pnpm build:win`) si falta `POS_VENDOR_SECRET`
 * o es demasiado corto para ser un secreto real.
 *
 * `electron.vite.config.ts` congela esa variable dentro del `.exe` al compilar — si no
 * está puesta en el entorno del build, el bundle queda con el secreto de desarrollo
 * (público, ver `src/main/services/license.ts`) y cualquiera podría falsificar licencias.
 */

import { KNOWN_LEAKED_SECRETS } from '../src/main/services/license'

const secret = process.env.POS_VENDOR_SECRET

if (!secret || secret.length < 20 || KNOWN_LEAKED_SECRETS.has(secret)) {
  console.error(
    '\n❌ POS_VENDOR_SECRET no está definido (o es muy corto, o es un valor público/de ' +
      'ejemplo ya conocido) en este entorno.\n\n' +
      'Generá un secreto largo y aleatorio UNA sola vez y guardalo en un lugar seguro\n' +
      '(gestor de contraseñas) — nunca lo subas al repo:\n\n' +
      '  openssl rand -base64 32\n\n' +
      'Después exportalo antes de compilar (y también antes de usar `pnpm license:gen`):\n\n' +
      '  export POS_VENDOR_SECRET="<el secreto que generaste>"\n\n' +
      'Build cancelado.\n'
  )
  process.exit(1)
}

console.log('✓ POS_VENDOR_SECRET configurado — compilando con el secreto de producción.')
