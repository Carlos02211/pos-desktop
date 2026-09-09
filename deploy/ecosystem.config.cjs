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
 * Rotación de logs (si no, crecen sin límite):
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 10M
 *   pm2 set pm2-logrotate:retain 14
 *   pm2 set pm2-logrotate:compress true
 *
 * La configuración de la app se toma de un `.env` junto a este (ver `.env.example`).
 * El servidor ABORTA el arranque si falta DATABASE_URL o POS_VENDOR_SECRET real
 * (revisar `pm2 logs pos-server` tras el primer `pm2 start`).
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
      time: true, // timestamp en cada línea de log
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}
