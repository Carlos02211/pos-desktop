import { defineConfig } from 'tsup'

/**
 * Empaqueta el servidor standalone de Fase 2 en `dist-server/server.cjs`.
 *
 * `--packages=external`: sólo se bundlea NUESTRO código; las dependencias se
 * resuelven de `node_modules` en el servidor (`npm install --omit=dev` en
 * `dist-server/` a partir del `package.json` que genera `scripts/build-server.mjs`).
 */
export default defineConfig({
  entry: { server: 'src/server/index.ts' },
  outDir: 'dist-server',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: false,
  dts: false,
  outExtension: () => ({ js: '.cjs' }),
  skipNodeModulesBundle: true,
  // Todo lo que no sea ruta relativa = dependencia externa: se resuelve de
  // node_modules en el servidor (ver el package.json que genera build-server.ts).
  external: [/^[^./]/]
})
