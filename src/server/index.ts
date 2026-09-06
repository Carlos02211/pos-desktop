import { mkdirSync } from 'fs'
import { closeDb, DIALECT, initDb } from '../main/db'
import { runSeed } from '../main/db/seed'
import { initStore } from '../main/lib/store'
import { startServer, type RunningServer } from '../main/server'
import { serverConfig as cfg } from './config'

/**
 * Servidor standalone de Fase 2 (multicajero en red local).
 *
 * Es el MISMO Fastify + Socket.io + lógica de negocio que corre dentro de
 * Electron en la Fase 1, pero sin el wrapper de Electron:
 *  - escucha en `0.0.0.0:3000` para las tabletas/laptops de la LAN,
 *  - sirve el build de React desde el propio servidor,
 *  - usa PostgreSQL si `DATABASE_URL` está definida (si no, SQLite).
 *
 * Pensado para arrancar bajo pm2 como servicio de Windows (ver `ecosystem.config.cjs`).
 */

let server: RunningServer | null = null

async function main(): Promise<void> {
  mkdirSync(cfg.dataDir, { recursive: true })
  initStore(cfg.dataDir)

  const db = await initDb(cfg.dbPath, cfg.migrationsDir)
  await runSeed(db)

  server = await startServer({
    host: cfg.host,
    port: cfg.port,
    version: cfg.version,
    isDev: false,
    dbPath: cfg.dbPath,
    backupDir: cfg.backupDir,
    uploadsDir: cfg.uploadsDir,
    staticDir: cfg.staticDir,
    allowedOrigins: cfg.allowedOrigins
  })

  console.log(
    `POS SpArTaN Tech — servidor Fase 2 en http://${cfg.host}:${cfg.port}` +
      ` · motor: ${DIALECT === 'pg' ? 'PostgreSQL' : 'SQLite'}`
  )
}

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} recibido — cerrando…`)
  try {
    if (server) await server.close()
    await closeDb()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

main().catch((err) => {
  console.error('[servidor] No se pudo iniciar:', err)
  process.exit(1)
})
