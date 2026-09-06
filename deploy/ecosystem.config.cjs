/**
 * pm2 — servidor POS SpArTaN Tech (Fase 2).
 *
 * En el servidor (PC principal):
 *   cd C:\pos-server
 *   npm install --omit=dev
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2-installer  (para arrancar como Servicio de Windows)
 *
 * La configuración se toma de un archivo `.env` junto a este (ver `.env.example`).
 */
module.exports = {
  apps: [
    {
      name: 'pos-server',
      script: 'server.cjs',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
