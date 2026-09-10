import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Carga `./.env` a `process.env` — SIN pisar valores que ya estén definidos.
 *
 * Se importa como PRIMERA línea del entry del servidor (`src/server/index.ts`),
 * antes que cualquier módulo que lea `process.env` en su top-level (p. ej.
 * `src/main/db/index.ts`, que decide el dialecto por `DATABASE_URL`).
 *
 * Node 20.6+ trae `--env-file`, pero pm2 no siempre lo pasa: lo hacemos a mano.
 */
const path = resolve(process.cwd(), '.env')
if (existsSync(path)) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
