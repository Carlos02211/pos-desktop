import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit sólo se usa para GENERAR archivos SQL de migración (`pnpm db:generate`).
 * Las migraciones se APLICAN en tiempo de ejecución desde el Main Process
 * (ver src/main/db/index.ts) para evitar conflictos de ABI de better-sqlite3
 * entre Node del sistema y Node de Electron.
 *
 * Las migraciones se emiten a `resources/migrations` para que electron-builder
 * las empaquete como `extraResources` y el migrador las encuentre en producción.
 */
export default defineConfig({
  schema: './src/main/db/schema.ts',
  out: './resources/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './.data/pos.dev.db'
  },
  strict: true,
  verbose: true
})
