import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { closeDb, initDb } from './db'
import { runSeed } from './db/seed'
import { initStore } from './lib/store'
import { paths } from './paths'
import { startServer, type RunningServer } from './server'

const API_PORT = 3001

let server: RunningServer | null = null

async function bootBackend(): Promise<void> {
  initStore(paths.dataDir)
  const db = initDb(paths.dbPath, paths.migrationsDir)
  await runSeed(db)
  server = await startServer({
    port: API_PORT,
    host: '127.0.0.1',
    version: app.getVersion(),
    isDev: is.dev,
    // En Fase 1 el único cliente es el Renderer local. Permitimos cualquier origen
    // en dev (Vite usa un puerto aleatorio) y el propio origin en prod.
    allowedOrigins: is.dev ? true : ['app://.', 'file://']
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.spartantech.pos')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    await bootBackend()
  } catch (err) {
    console.error('[main] No se pudo iniciar el backend:', err)
    app.quit()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', async (event) => {
  if (!server) return
  event.preventDefault()
  const s = server
  server = null
  try {
    await s.close()
    closeDb()
  } finally {
    app.quit()
  }
})
