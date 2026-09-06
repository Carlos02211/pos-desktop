/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override manual del baseURL de la API (Fase 2 con dominio distinto). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
