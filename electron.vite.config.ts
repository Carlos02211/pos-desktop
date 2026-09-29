import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { buildInfo } from './scripts/build-info'

const build = buildInfo()

export default defineConfig({
  main: {
    // La clave pública de licencias queda fija en el código: el .exe ignora cualquier
    // POS_LICENSE_PUBLIC_KEY del entorno (ver src/main/services/license.ts).
    define: {
      'process.env.POS_LICENSE_PUBLIC_KEY': '""',
      'process.env.POS_BUILD_COMMIT': JSON.stringify(build.commit),
      'process.env.POS_BUILD_DATE': JSON.stringify(build.date)
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Versión de las pantallas; Configuración la compara con la del servidor.
    define: { __POS_BUILD__: JSON.stringify(build) },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
