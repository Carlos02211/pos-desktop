/**
 * Empaqueta el servidor standalone de Fase 2 en `dist-server/`.
 *
 *   pnpm build:server
 *     1. pnpm build            → out/renderer  (build de React)
 *     2. tsup                  → dist-server/server.cjs
 *     3. copia public/ migrations-pg/ ecosystem env-ejemplo.txt *.ps1 (con BOM)
 *     4. genera dist-server/package.json SOLO con las deps de runtime del servidor
 *        (PostgreSQL) — sin better-sqlite3, así el cliente NO necesita compilador.
 *
 * `dist-server/` es AUTOCONTENIDO: el cliente sólo copia ESA carpeta. En el servidor:
 *   cd pos-server && npm install --omit=dev && pm2 start ecosystem.config.cjs
 */
import { execSync } from 'child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-server')

// Deps que el servidor standalone (PostgreSQL) NO usa en runtime:
//  - Electron-only.
//  - better-sqlite3: es un módulo NATIVO (necesita Python + VS Build Tools para
//    compilar). Fase 2 es PostgreSQL siempre (el arranque aborta sin DATABASE_URL),
//    y `db/index.ts` sólo lo importa dinámicamente en la rama SQLite. Excluirlo
//    hace que `npm install` en el cliente no necesite ningún compilador.
const SERVER_EXCLUDE = new Set([
  '@electron-toolkit/preload',
  '@electron-toolkit/utils',
  'better-sqlite3',
  // `electron-store` importa el paquete `electron`. El servidor usa un store en
  // JSON plano (ver src/main/lib/store.ts, modo 'file') — no lo necesita.
  'electron-store'
])

function run(cmd: string): void {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

run('pnpm build')
run('pnpm exec tsup')

cpSync(join(root, 'out/renderer'), join(out, 'public'), { recursive: true })
cpSync(join(root, 'resources/migrations-pg'), join(out, 'migrations-pg'), { recursive: true })
cpSync(join(root, 'deploy/ecosystem.config.cjs'), join(out, 'ecosystem.config.cjs'))
// La plantilla va con nombre visible y CRLF: un `.env.example` (archivo oculto en Linux)
// se pierde al arrastrar la carpeta a Windows, y el Bloc de notas prefiere CRLF.
writeFileSync(
  join(out, 'env-ejemplo.txt'),
  readFileSync(join(root, 'deploy/.env.example'), 'utf8').replace(/\r?\n/g, '\r\n')
)
// Los .ps1 van con BOM UTF-8: Windows PowerShell 5.1 lee los archivos sin BOM como
// Windows-1252, y los bytes de «—» / acentos rompen el parser (0x94 = comilla ”).
for (const ps1 of ['setup-server.ps1', 'ip-fija.ps1', 'setup-https.ps1', 'backup-pg.ps1']) {
  const text = readFileSync(join(root, 'deploy', ps1), 'utf8').replace(/^\uFEFF/, '')
  writeFileSync(join(out, ps1), '\uFEFF' + text.replace(/\r?\n/g, '\r\n'))
}
// Sin sourcemap en producción (expone el código del backend).
rmSync(join(out, 'server.cjs.map'), { force: true })

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string
  dependencies: Record<string, string>
}
const dependencies = Object.fromEntries(
  Object.entries(rootPkg.dependencies).filter(([name]) => !SERVER_EXCLUDE.has(name))
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

writeFileSync(
  join(out, 'LEEME.txt'),
  [
    'POS SpArTaN Tech — servidor Fase 2',
    '',
    'Esta carpeta es lo ÚNICO que va al servidor del cliente. Copiala como C:\\pos-server',
    '',
    'Contenido:',
    '  server.cjs            el servidor (bundle)',
    '  public/               la app web (React) que se sirve a las tabletas',
    '  migrations-pg/        migraciones de PostgreSQL (se aplican solas al arrancar)',
    '  package.json          dependencias de runtime (sin better-sqlite3 → sin compilador)',
    '  env-ejemplo.txt       plantilla: setup-server.ps1 la copia a .env (editar DATABASE_URL)',
    '  ecosystem.config.cjs  configuración de pm2',
    '  setup-server.ps1      instalación idempotente (Node, npm install, pm2, firewall)',
    '  ip-fija.ps1           fija la IP de esta PC (las cajas la buscan siempre en la misma)',
    '  setup-https.ps1       HTTPS en la red local con mkcert (después de ip-fija.ps1)',
    '  backup-pg.ps1         respaldo MANUAL (los automáticos los hace el servidor)',
    '',
    'Pasos: ver docs/fase-2-instalacion-windows.md (o correr setup-server.ps1 como admin).'
  ].join('\n') + '\n'
)

console.log('\n✅ dist-server/ listo (autocontenido). Es lo único que va al servidor del cliente.')
