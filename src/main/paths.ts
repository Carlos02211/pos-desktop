import { app } from 'electron'
import { join } from 'path'

/**
 * Rutas del sistema de archivos que usa el Main Process.
 *
 * Fase 1:
 *   - La base de datos y los uploads viven en `userData` (fuera del asar, editable).
 *   - Las migraciones se empaquetan como `extraResources` (ver electron-builder.yml).
 *   - El respaldo apunta por defecto a `userData/backups`; en el equipo del cliente
 *     se reconfigura al SSD de respaldo desde la tabla `config` (Sprint 3).
 */

const dataDir = (): string => app.getPath('userData')

export const paths = {
  get dataDir(): string {
    return dataDir()
  },
  get dbPath(): string {
    return join(dataDir(), 'pos.db')
  },
  get uploadsDir(): string {
    return join(dataDir(), 'uploads')
  },
  get productImagesDir(): string {
    return join(dataDir(), 'uploads', 'productos')
  },
  get configUploadsDir(): string {
    return join(dataDir(), 'uploads', 'config')
  },
  get backupDir(): string {
    return join(dataDir(), 'backups')
  },
  get migrationsDir(): string {
    // dev: <proyecto>/resources/migrations  (__dirname = <proyecto>/out/main)
    // prod: <recursos>/migrations
    return app.isPackaged
      ? join(process.resourcesPath, 'migrations')
      : join(__dirname, '../../resources/migrations')
  }
}
