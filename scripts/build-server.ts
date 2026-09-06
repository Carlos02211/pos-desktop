/**
 * Empaqueta el servidor standalone de Fase 2 en `dist-server/`.
 *
 *   pnpm build:server
 *     1. pnpm build            → out/renderer  (build de React)
 *     2. tsup                  → dist-server/server.cjs
 *     3. copia public/ migrations/ migrations-pg/ ecosystem .env.example
 *     4. genera dist-server/package.json con las deps de runtime
 *
 * En el servidor:  cd dist-server && npm install --omit=dev && pm2 start ecosystem.config.cjs
 */
import { execSync } from 'child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-server')

// Deps de Electron que el servidor no usa.
const ELECTRON_ONLY = new Set(['@electron-toolkit/preload', '@electron-toolkit/utils'])

function run(cmd: string): void {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

run('pnpm build')
run('pnpm exec tsup')

cpSync(join(root, 'out/renderer'), join(out, 'public'), { recursive: true })
cpSync(join(root, 'resources/migrations'), join(out, 'migrations'), { recursive: true })
cpSync(join(root, 'resources/migrations-pg'), join(out, 'migrations-pg'), { recursive: true })
cpSync(join(root, 'deploy/ecosystem.config.cjs'), join(out, 'ecosystem.config.cjs'))
cpSync(join(root, 'deploy/.env.example'), join(out, '.env.example'))

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string
  dependencies: Record<string, string>
}
const dependencies = Object.fromEntries(
  Object.entries(rootPkg.dependencies).filter(([name]) => !ELECTRON_ONLY.has(name))
)

writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'pos-spartan-tech-server',
      version: rootPkg.version,
      private: true,
      description: 'Servidor standalone de POS SpArTaN Tech (Fase 2)',
      main: 'server.cjs',
      scripts: { start: 'node server.cjs' },
      dependencies
    },
    null,
    2
  ) + '\n'
)

console.log('\n✅ dist-server/ listo. Cópialo al servidor y sigue docs/fase-2-migracion.md')
