# Fase 2 — Servidor local multicajero

Guía de migración de la Fase 1 (app de escritorio Electron + SQLite) a la Fase 2
(servidor en la LAN + PostgreSQL + tabletas por navegador).

El código de la API, la lógica de negocio, los componentes React y los eventos
Socket.io **no cambian**: sólo cambia dónde corre el servidor y contra qué base
de datos. Trabajo estimado: 3–5 días.

```
Router (IP fija 192.168.1.10)
│
├── PC servidor (Windows) ── pm2 ── node server.cjs  :3000
│                            └── PostgreSQL 16       :5432 (sólo local)
│                            └── SPA de React servida por el mismo Fastify
│                            └── impresora térmica XP-80T (USB)
│
├── Tableta cobrador 1  → Chrome → http://192.168.1.10:3000/  → /#/cobrador
├── Tableta cobrador 2  → Chrome → http://192.168.1.10:3000/  → /#/cobrador
└── Laptop admin        → Chrome → http://192.168.1.10:3000/  → /#/admin
```

---

## Qué trae ya el repositorio

| Pieza                           | Dónde                                                         |
| ------------------------------- | ------------------------------------------------------------- |
| Driver dual SQLite / PostgreSQL | `src/main/db/index.ts` (elige por `DATABASE_URL`)             |
| Esquema PostgreSQL              | `src/main/db/schema.pg.ts`                                    |
| Migraciones PostgreSQL          | `resources/migrations-pg/` (`pnpm db:generate:pg`)            |
| Servidor sin Electron           | `src/server/index.ts`                                         |
| Script de migración de datos    | `scripts/sqlite-to-postgres.ts` (`pnpm migrate:sqlite-to-pg`) |
| Bundle de despliegue            | `pnpm build:server` → `dist-server/`                          |
| Config de pm2 + `.env`          | `deploy/ecosystem.config.cjs`, `deploy/.env.example`          |
| Verificación contra PostgreSQL  | `pnpm verify:backend:pg` (PGlite, sin servidor)               |

El cliente resuelve el `baseURL` solo: servido por HTTP usa el **mismo origen**,
así que no hay ninguna constante que editar (ver `src/renderer/src/api/client.ts`).

---

## Día 1 — PostgreSQL y datos

1. **Instalar PostgreSQL 16** en la PC principal. Crear base y usuario:

   ```sql
   CREATE USER pos WITH PASSWORD 'una-clave-larga';
   CREATE DATABASE pos OWNER pos;
   ```

   Dejar `listen_addresses = 'localhost'` en `postgresql.conf` (sólo la app local
   habla con la base; las tabletas nunca tocan PostgreSQL).

2. **Migrar los datos** de la última `pos.db` de Fase 1:

   ```bash
   pnpm db:generate:pg     # si no existe resources/migrations-pg
   DATABASE_URL=postgres://pos:una-clave-larga@localhost:5432/pos \
     pnpm migrate:sqlite-to-pg -- --source "C:\ruta\a\pos.db"
   ```

   El script aplica las migraciones a PostgreSQL, copia todas las tablas
   preservando los IDs y reajusta las secuencias. Con `--truncate` vacía las
   tablas destino antes de copiar (para repetir la prueba).

3. **Verificar la integridad**: comparar totales por tabla entre origen y destino
   (`SELECT count(*)` fila a fila) y hacer un par de reportes de prueba.

---

## Día 2 — Probar la API contra PostgreSQL

Sin tocar código. Usar **`verify:backend`** (sin `:pg`) — ese script no fija `DATABASE_URL`
así que sí respeta el valor que le pases en la terminal; `verify:backend:pg` no sirve para esto
porque trae `DATABASE_URL=pglite://memory` fijo adentro (`cross-env` lo pisa siempre):

```bash
# PowerShell (en la PC servidor):
$env:DATABASE_URL = "postgres://pos:...@localhost:5432/pos"
pnpm verify:backend

# bash/zsh:
DATABASE_URL=postgres://pos:...@localhost:5432/pos pnpm verify:backend
```

`verify:backend:pg` sigue sirviendo tal cual para correr las mismas comprobaciones contra
PGlite embebido (sin necesitar un PostgreSQL real instalado) — es lo que usa el CI/dev local.

---

## Día 3 — Servidor standalone + pm2

1. En la máquina de desarrollo:

   ```bash
   pnpm build:server        # genera dist-server/
   ```

2. Copiar `dist-server/` a la PC servidor (p. ej. `C:\pos-server`).

3. En la PC servidor (con Node 20.19+ o 22 LTS instalado):

   ```bash
   cd C:\pos-server
   copy .env.example .env      # y editar .env
   npm install --omit=dev      # reconstruye better-sqlite3 para ESTE Node
   npm install -g pm2
   pm2 start ecosystem.config.cjs
   pm2 save
   ```

   `.env` mínimo:

   ```
   PORT=3000
   DATABASE_URL=postgres://pos:una-clave-larga@localhost:5432/pos
   POS_DATA_DIR=C:\pos-server\data
   POS_VENDOR_SECRET=...            # el mismo del generador de licencias
   ```

4. **Servicio de Windows** con [`pm2-installer`](https://github.com/jessety/pm2-installer)
   para que arranque solo al encender la PC:

   ```bash
   # en una carpeta aparte
   npm install pm2-installer --no-save
   npm run configure
   npm run setup
   ```

5. Probar en el propio servidor: `http://localhost:3000/api/ping`
   → `{"phase":2,"engine":"postgres","db":"connected"}`.

---

## Día 4 — Red local

1. **IP fija** para la PC servidor en el router (reserva DHCP), p. ej. `192.168.1.10`.

2. **Firewall de Windows**: permitir el puerto TCP `3000` entrante
   (perfil _Privado_).

   ```powershell
   New-NetFirewallRule -DisplayName "POS SpArTaN Tech" -Direction Inbound `
     -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
   ```

3. **Origen** (`.env`): normalmente no hace falta `POS_ALLOWED_ORIGINS` porque la
   SPA se sirve desde el mismo servidor. Sólo si alojas el cliente en otro sitio,
   ponlo con la URL de ese sitio.

4. En cada tableta/laptop: abrir `http://192.168.1.10:3000/` en Chrome y crear un
   acceso directo a pantalla completa.

---

## Día 5 — QA multicajero

- Dos cobradores con caja abierta a la vez → cada venta con su folio por sesión.
- Venta desde la tableta A → aparece al instante en el dashboard del admin
  (Socket.io emite a todos los clientes conectados).
- Editar un producto en el admin → el grid del cobrador se refresca solo.
- **Impresora**: mantenerla USB en el servidor y poner
  `printer_interface` en Configuración (p. ej. `printer:XP-80T` en Windows), o
  moverla a red y usar `tcp://192.168.1.50:9100`.
- **Respaldo**: en PostgreSQL el cierre de caja ya no copia un archivo; programar
  `pg_dump` en el Programador de tareas de Windows:

  ```
  pg_dump -U pos -Fc pos > C:\pos-server\backups\pos_%DATE%.dump
  ```

---

## Volver a SQLite

Quitar `DATABASE_URL` del `.env` y reiniciar (`pm2 restart pos-server`). El
servidor vuelve a usar `POS_DB_PATH` (SQLite). Útil como plan B si PostgreSQL
falla; los datos nuevos quedarían en SQLite hasta re-migrar.
