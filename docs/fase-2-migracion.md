# Fase 2 — Servidor local multicajero

Guía de migración de la Fase 1 (app de escritorio Electron + SQLite) a la Fase 2
(servidor en la LAN + PostgreSQL + tabletas por navegador).

El código de la API, la lógica de negocio, los componentes React y los eventos
Socket.io **no cambian de contrato**: sólo cambia dónde corre el servidor y contra
qué base de datos. Trabajo estimado: 3–5 días.

```
Router (IP fija 192.168.1.10)
│
├── PC servidor (Windows) ── pm2 ── node server.cjs  :3000  (HTTP o HTTPS)
│                            └── PostgreSQL 16       :5432 (sólo local)
│                            └── SPA de React servida por el mismo Fastify
│                            └── impresora térmica XP-80T (USB)
│
├── Tableta cobrador 1  → Chrome → http(s)://192.168.1.10:3000/  → /#/cobrador
├── Tableta cobrador 2  → Chrome → http(s)://192.168.1.10:3000/  → /#/cobrador
└── Laptop admin        → Chrome → http(s)://192.168.1.10:3000/  → /#/admin
```

> **Checklist real probado en VM Windows:** [`docs/fase-2-instalacion-windows.md`](fase-2-instalacion-windows.md)
> — pasos exactos, errores concretos que salieron y cómo se resolvieron.

---

## Qué trae ya el repositorio

| Pieza                                | Dónde                                                           |
| ------------------------------------ | ------------------------------------------------------------- |
| Driver dual SQLite / PostgreSQL      | `src/main/db/index.ts` (elige por `DATABASE_URL`)             |
| Esquema PostgreSQL                   | `src/main/db/schema.pg.ts` (espejo de `schema.sqlite.ts`)     |
| Migraciones PostgreSQL               | `resources/migrations-pg/` — **ya generadas, no re-generar en el servidor** |
| Servidor sin Electron                | `src/server/index.ts` (+ validación de arranque en `config.ts`) |
| Script de migración de datos         | `scripts/sqlite-to-postgres.ts` (`pnpm migrate:sqlite-to-pg`)  |
| Bundle de despliegue                 | `pnpm build:server` → `dist-server/`                          |
| Config de pm2 + `.env`               | `deploy/ecosystem.config.cjs`, `deploy/.env.example`          |
| Autenticación de Socket.io           | `src/main/socket.ts` — handshake con JWT (transparente para el cliente) |
| HTTPS opcional                       | `POS_TLS_KEY` / `POS_TLS_CERT` en el `.env`                   |
| Rate-limit de login y de activación  | `src/main/lib/throttle.ts`                                    |

El cliente resuelve el `baseURL` solo: servido por HTTP/HTTPS usa el **mismo
origen**, así que no hay ninguna constante que editar
(ver `src/renderer/src/api/client.ts`).

### Cambios recientes que afectan el despliegue (auditoría 2026-09-09)

- **PostgreSQL es obligatorio.** El servidor standalone **aborta el arranque** si
  `DATABASE_URL` no está, o si apunta a `pglite://` (SQLite no es seguro con varias
  tabletas concurrentes). Se puede saltar sólo en pruebas con `POS_ALLOW_INSECURE=1`.
- **`POS_VENDOR_SECRET` real es obligatorio.** El servidor aborta si falta o si es
  el valor de ejemplo / un valor filtrado conocido.
- **No hay usuario `cajero` de prueba en producción.** El seed sólo crea `admin`;
  su contraseña sale de `POS_ADMIN_PASSWORD` o se genera al azar y se imprime **una
  vez** en el log de pm2.
- **Importes en centavos.** La migración `0006` (SQLite) / `0005-pg` convierte los
  datos existentes de coma flotante a enteros de centavos. La API sigue devolviendo
  pesos decimales — el renderer no cambia. Ver más abajo.
- **CORS por defecto = sólo mismo origen** (antes: cualquiera). Sólo hace falta
  `POS_ALLOWED_ORIGINS` si la SPA se sirve desde otro host.
- **Node.js ≥ 22** (`electron-store@11` es ESM puro; `require()` desde el bundle
  CJS necesita Node 22).

---

## Día 1 — PostgreSQL y datos

1. **Instalar PostgreSQL 16** en la PC servidor. Crear base y usuario:

   ```sql
   CREATE USER pos WITH PASSWORD 'una-clave-larga';
   CREATE DATABASE pos OWNER pos;
   ```

   Dejar `listen_addresses = 'localhost'` en `postgresql.conf` (sólo la app local
   habla con la base; las tabletas nunca tocan PostgreSQL).

2. **Migrar los datos** de la última `pos.db` de Fase 1:

   ```bash
   DATABASE_URL=postgres://pos:una-clave-larga@localhost:5432/pos \
     pnpm migrate:sqlite-to-pg -- --source "C:\ruta\a\pos.db"
   ```

   El script, en **una sola transacción**:
   - aplica las migraciones de `resources/migrations-pg/` a PostgreSQL;
   - deriva las columnas a copiar de `information_schema` del destino (no de una
     lista fija — así no se pierden columnas nuevas en silencio);
   - aborta antes de tocar nada si el destino tiene una columna `NOT NULL` sin
     default que el origen no puede rellenar;
   - copia todas las tablas preservando los IDs y reajusta las secuencias;
   - **verifica** el número de filas por tabla y las sumas de control
     (`sum(total)` de ventas, `sum(subtotal)` de líneas) entre origen y destino;
     si algo no cuadra hace `ROLLBACK` y la base destino queda intacta.

   Con `--truncate` vacía las tablas destino antes de copiar (para repetir la
   prueba). El "rollback" real ante un fallo grave es `DROP DATABASE pos; CREATE …`.

3. **Antes de migrar en la PC del cliente**: hacer un `pg_dump` de la base destino
   (aunque esté vacía) y una copia del `pos.db` origen. Son datos financieros.

> **Nota sobre los importes en centavos:** si el `pos.db` origen viene de una
> versión anterior a este cambio, sus precios están en coma flotante. La migración
> de esquema (`0005-pg`) los convierte con `round(x * 100)` al aplicar
> `ALTER COLUMN … USING …`. La migración de datos (paso 2) copia valores ya en
> centavos 1:1. No hay acción manual.

---

## Día 2 — Probar la API contra PostgreSQL real

Sin tocar código. Usar **`verify:backend`** (sin `:pg`) — ese script no fija
`DATABASE_URL`, así que respeta el valor que le pases en la terminal.
`verify:backend:pg` **no sirve para esto**: trae `DATABASE_URL=pglite://memory`
fijo adentro (`cross-env` lo pisa siempre) y PGlite es mono-conexión, no reproduce
la concurrencia real.

```powershell
# PowerShell (en la PC servidor):
$env:DATABASE_URL = "postgres://pos:...@localhost:5432/pos"
pnpm verify:backend
```

```bash
# bash/zsh:
DATABASE_URL=postgres://pos:...@localhost:5432/pos pnpm verify:backend
```

Las ~150 comprobaciones deben pasar en verde contra el PostgreSQL real (cubren el
flujo completo de venta, caja, cuentas por cobrar, reportes, folios únicos e
importes en centavos exactos).

Este PostgreSQL **persiste entre corridas**. Para repetir la prueba hay que vaciar
la base antes de cada corrida (conectado como `postgres`):

```sql
DROP DATABASE pos; CREATE DATABASE pos OWNER pos;
```

En el despliegue real se corre una sola vez, recién migrada la base.

`verify:backend:pg` (PGlite embebido) sigue sirviendo para el chequeo rápido de
dev/CI sin instalar PostgreSQL.

---

## Día 3 — Servidor standalone + pm2

1. En la máquina de desarrollo:

   ```bash
   pnpm build:server        # genera dist-server/ (incluye resources/migrations-pg)
   ```

2. Copiar `dist-server/` a la PC servidor (p. ej. `C:\pos-server`).
   **No** correr `pnpm db:generate:pg` en el servidor — las migraciones ya vienen
   en el bundle.

3. En la PC servidor (Node **22 LTS**):

   ```powershell
   cd C:\pos-server
   copy .env.example .env      # y editar .env (ver abajo)
   npm install --omit=dev      # reconstruye better-sqlite3 para ESTE Node
   npm install -g pm2
   pm2 start ecosystem.config.cjs
   pm2 save
   ```

   **`.env` mínimo de producción** (el servidor **aborta** si falta alguno):

   ```ini
   PORT=3000
   HOST=0.0.0.0

   # Obligatorio. Instancia real, no pglite://.
   DATABASE_URL=postgres://pos:una-clave-larga@localhost:5432/pos

   POS_DATA_DIR=C:\pos-server\data

   # Obligatorio. Generar UNA vez con `openssl rand -base64 32`, guardar en un
   # gestor de contraseñas. Debe ser EL MISMO que se usa con `pnpm license:gen`.
   POS_VENDOR_SECRET=<secreto-real-largo-y-aleatorio>

   # Opcional. Si se omite, el servidor genera la contraseña de `admin` al azar
   # y la imprime UNA vez en el log de pm2 (`pm2 logs pos-server`). Anotarla.
   # POS_ADMIN_PASSWORD=<mínimo 8 caracteres>
   ```

4. **Primer arranque — anotar la contraseña de `admin`:**

   ```powershell
   pm2 logs pos-server --lines 50
   ```

   Buscar el bloque `POS SpArTaN Tech — usuario administrador inicial`. No se
   vuelve a mostrar. Cambiarla desde el panel al primer login.

5. **Servicio de Windows** con [`pm2-installer`](https://github.com/jessety/pm2-installer)
   para que arranque solo al encender la PC:

   ```powershell
   npm install pm2-installer --no-save
   npm run configure
   npm run setup
   ```

6. **Rotación de logs de pm2** (si no, crecen sin límite):

   ```powershell
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 14
   pm2 set pm2-logrotate:compress true
   ```

7. Probar en el propio servidor: `http://localhost:3000/api/ping`
   → `{"phase":2,"engine":"postgres","db":"connected"}`.

---

## Día 4 — Red local y TLS

1. **IP fija** para la PC servidor en el router (reserva DHCP), p. ej. `192.168.1.10`.

2. **Firewall de Windows**: permitir el puerto TCP `3000` entrante (perfil _Privado_).

   ```powershell
   New-NetFirewallRule -DisplayName "POS SpArTaN Tech" -Direction Inbound `
     -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
   ```

3. **Orígenes (`POS_ALLOWED_ORIGINS`)**: normalmente **no hace falta** — la SPA se
   sirve desde el mismo servidor (mismo origen). El default ya es "sólo mismo
   origen"; una web externa no puede llamar a la API. Sólo poner
   `POS_ALLOWED_ORIGINS=http://otro-host:puerto` si alojas la SPA en otro lado.

4. **TLS (recomendado si las tabletas van por WiFi).** Sin TLS, las contraseñas y
   los tokens JWT viajan en claro por la red y son capturables. Con
   [`mkcert`](https://github.com/FiloSottile/mkcert):

   ```powershell
   mkcert -install
   mkcert 192.168.1.10 pos.local          # genera 2 archivos .pem
   ```

   En el `.env`:

   ```ini
   POS_TLS_KEY=C:\pos-server\certs\192.168.1.10+1-key.pem
   POS_TLS_CERT=C:\pos-server\certs\192.168.1.10+1.pem
   ```

   Copiar `rootCA.pem` de mkcert (`mkcert -CAROOT`) e **importarlo como autoridad
   de confianza en cada tableta** (Android: Ajustes → Seguridad → Cifrado y
   credenciales → Instalar un certificado → Certificado de CA). Luego las tabletas
   abren `https://192.168.1.10:3000/`.

   Si el cliente rechaza la complejidad y la LAN es cableada y de confianza, se
   puede dejar en HTTP y documentarlo como riesgo aceptado.

5. En cada tableta/laptop: abrir la URL en Chrome y crear un acceso directo a
   pantalla completa.

---

## Día 5 — QA multicajero

- **Dos cobradores** con caja abierta a la vez → cada venta con su folio por
  sesión. El folio es único por sesión a nivel de base de datos
  (`UNIQUE(cash_session_id, ticket_number)`), y las ventas de una misma caja se
  serializan con `SELECT … FOR UPDATE` — no puede haber folios duplicados.
- **Una sola caja abierta por cobrador**: garantía de base de datos (índice único
  parcial). Un segundo intento de apertura da 409.
- **Abonos simultáneos** a la misma cuenta → el saldo queda correcto (la fila se
  bloquea durante el abono).
- Venta desde la tableta A → aparece al instante en el dashboard del admin
  (Socket.io). El socket **exige un JWT válido** en el handshake — un dispositivo
  sin sesión iniciada no recibe ningún evento. Es transparente: el cliente conecta
  el socket al hacer login.
- Editar un producto en el admin → el grid del cobrador se refresca solo.
- **Impresora**: mantenerla USB en el servidor y poner `printer_interface` en
  Configuración (p. ej. `printer:XP-80T` en Windows), o moverla a red y usar
  `tcp://192.168.1.50:9100`. Si la impresora no responde, la venta se registra
  igual y el ticket falla con aviso (timeout de 4 s, no bloquea).
- **Importes**: verificar un par de cierres de caja con ventas grandes (costales)
  — el efectivo esperado debe cuadrar al centavo.

---

## Respaldo de PostgreSQL

En PostgreSQL el cierre de caja ya no copia un archivo. Programar un respaldo con
el Programador de tareas de Windows. **No usar `%DATE%`** (depende del locale y
genera nombres inválidos). Script `backup-pg.ps1`:

```powershell
$ErrorActionPreference = "Stop"
$stamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$dir     = "C:\pos-server\backups"
$dump    = "$dir\pos_$stamp.dump"
$env:PGPASSWORD = "una-clave-larga"

New-Item -ItemType Directory -Force -Path $dir | Out-Null
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U pos -Fc pos -f $dump

# Verifica que el dump no esté corrupto
& "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" --list $dump | Out-Null

# Retención: borra los de más de 14 días
Get-ChildItem "$dir\pos_*.dump" | Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) | Remove-Item

# (Opcional) copiar a un segundo disco / NAS
# Copy-Item $dump "\\NAS\backups\pos\"
```

Tarea programada (diaria, 23:30):

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\pos-server\backup-pg.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 11:30PM
Register-ScheduledTask -TaskName "POS backup PostgreSQL" -Action $action -Trigger $trigger `
  -RunLevel Highest -Description "Respaldo diario de la base del POS"
```

Probar una **restauración real** una vez por trimestre:
`pg_restore -U postgres -d pos_test -C pos_YYYYMMDD-HHMMSS.dump`.

---

## Volver a SQLite (plan B)

`DATABASE_URL` es obligatorio en el servidor standalone, así que "volver a SQLite"
en producción **no está soportado** (SQLite es mono-cliente). Si PostgreSQL falla,
el plan B es restaurar el último `pg_dump` en una instancia nueva. Para pruebas
locales de una sola persona se puede arrancar con `POS_ALLOW_INSECURE=1` y sin
`DATABASE_URL`.
