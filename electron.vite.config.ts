import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Congela POS_VENDOR_SECRET dentro del bundle al compilar (ver scripts/check-vendor-secret.ts):
    // el .exe empaquetado no lee variables de entorno en la PC del cliente, así que el secreto
    // real tiene que quedar fijo en el código en el momento de correr `pnpm build`/`build:win`.
    define: {
      'process.env.POS_VENDOR_SECRET': JSON.stringify(process.env.POS_VENDOR_SECRET ?? '')
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
