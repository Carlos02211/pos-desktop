import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit para el dialecto PostgreSQL (Fase 2).
 *
 * Sólo GENERA los archivos SQL de migración (`pnpm db:generate:pg`) a partir de
 * `src/main/db/schema.pg.ts`. Se APLICAN en tiempo de ejecución desde
 * `src/main/db/index.ts` (igual que en SQLite).
 *
 * La carpeta `resources/migrations-pg` se empaqueta con el servidor standalone.
 */
export default defineConfig({
  schema: './src/main/db/schema.pg.ts',
  out: './resources/migrations-pg',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/pos'
  },
  strict: true,
  verbose: true
})
