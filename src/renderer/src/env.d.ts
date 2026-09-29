/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override manual del baseURL de la API (Fase 2 con dominio distinto). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Commit y fecha de compilación de las pantallas (lo define electron.vite.config.ts). */
declare const __POS_BUILD__: { commit: string; date: string }
