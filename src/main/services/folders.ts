import { existsSync, mkdirSync, readdirSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import type { FolderListing } from '../../shared/types'
import { HttpError } from '../lib/http-error'

/**
 * Navegador de carpetas del SERVIDOR (para elegir la carpeta de respaldos desde el panel
 * admin). Sólo lista carpetas, nunca archivos. Las carpetas del sistema u ocultas
 * (`$Recycle.Bin`, `.git`, …) se omiten.
 */

const HIDDEN = new Set(['System Volume Information', 'Recovery', 'PerfLogs', 'Config.Msi'])

function roots(): FolderListing {
  if (process.platform === 'win32') {
    const dirs = 'CDEFGHIJKLMNOPQRSTUVWXYZ'
      .split('')
      .map((l) => `${l}:\\`)
      .filter((d) => existsSync(d))
      .map((d) => ({ name: d.slice(0, 2), path: d }))
    return { path: null, parent: null, dirs }
  }
  return listFolder('/')
}

export function listFolder(path?: string): FolderListing {
  if (!path) return roots()
  if (!isAbsolute(path)) throw new HttpError(400, 'La ruta debe ser absoluta.')
  const abs = resolve(path)
  let entries
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    throw new HttpError(400, 'No se puede abrir esa carpeta (no existe o no hay permiso).')
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !/^[.$]/.test(e.name) && !HIDDEN.has(e.name))
    .map((e) => ({ name: e.name, path: join(abs, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  const up = dirname(abs)
  // En la raíz de una unidad (C:\) o de "/", "subir" vuelve a la lista de unidades.
  const parent = up === abs ? (process.platform === 'win32' ? '' : null) : up
  return { path: abs, parent, dirs }
}

const INVALID_NAME = /[<>:"/\\|?*]|^\.+$|^\s|\s$/

export function createFolder(parent: string, name: string): string {
  if (!isAbsolute(parent)) throw new HttpError(400, 'La ruta debe ser absoluta.')
  if (!name || INVALID_NAME.test(name)) {
    throw new HttpError(400, 'Nombre de carpeta inválido.')
  }
  const path = join(resolve(parent), name)
  try {
    mkdirSync(path, { recursive: true })
  } catch {
    throw new HttpError(400, 'No se pudo crear la carpeta (¿permisos?).')
  }
  return path
}
