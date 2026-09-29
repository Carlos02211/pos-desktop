/**
 * Versión compilada (commit + fecha), fijada en el bundle por tsup / electron-vite
 * (ver scripts/build-info.ts). Con `tsx` / `pnpm dev` no existe → "desarrollo".
 */
export const BUILD_COMMIT = process.env.POS_BUILD_COMMIT || 'desarrollo'
export const BUILD_DATE = process.env.POS_BUILD_DATE || null
