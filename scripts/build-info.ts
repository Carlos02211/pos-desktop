import { execSync } from 'node:child_process'

/**
 * Commit y fecha de compilación, para saber qué versión corre en cada PC.
 * Lo usan tsup (servidor) y electron-vite (pantallas): así se nota si en el cliente
 * quedó el servidor de una versión y `public/` de otra.
 */
export function buildInfo(): { commit: string; date: string } {
  let commit = 'desconocido'
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    const dirty = execSync('git status --porcelain --untracked-files=no', {
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
    if (dirty) commit += '+cambios'
  } catch {
    // Sin git (p. ej. build desde un zip): se queda "desconocido".
  }
  return { commit, date: new Date().toISOString() }
}
