# Fase 2 — Checklist real de instalación en Windows

Complemento de [`docs/fase-2-migracion.md`](fase-2-migracion.md) (el runbook por días). Este
archivo documenta los pasos **tal como pasaron de verdad** en una VM de prueba (Windows 11),
con los errores concretos que salieron y cómo se resolvieron — para no repetirlos en la PC
real del cliente.

**Estado: Día 1 y Día 2 completos y verificados. Día 3 en adelante (sección 6), pendiente — retomar ahí.**

> **Cambios de la auditoría 2026-09-09 que afectan la instalación** (ver
> [`docs/auditoria-2026-09-09.md`](auditoria-2026-09-09.md)): el servidor ahora **exige**
> `DATABASE_URL` (PostgreSQL real) y `POS_VENDOR_SECRET` propio, o no arranca; no siembra el
> `cajero` de prueba; la contraseña de `admin` se genera al azar; el Socket.io exige JWT;
> HTTPS opcional; los importes se guardan en centavos. Todo esto está reflejado abajo.

---

## 0. Software a instalar (todo, de una vez, para no ir de a poco)

| Software | Para qué | Nota |
| --- | --- | --- |
| PostgreSQL 16 | La base de datos de Fase 2 | Dejar `listen_addresses = 'localhost'` |
| Node.js 22 LTS | Correr el proyecto y el servidor | Trae `npm` incluido |
| Python 3.12 | `node-gyp` lo necesita para compilar módulos nativos (`better-sqlite3`) | Ver gotcha abajo |
| Visual Studio Build Tools 2022 | El compilador de C++ que `node-gyp` necesita | **Con el workload "Desktop development with C++"** — ver gotcha abajo, es fácil que quede sin instalar |

Con `winget` (viene en Windows 11):

```powershell
winget install -e --id Python.Python.3.12
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools"
```

**Gotcha real que pasó**: el `--override` del segundo comando NO agregó el workload de C++ —
sólo instaló las "core features" de Build Tools. `node-gyp` fallaba con:

```
gyp ERR! find VS - missing any VC++ toolset
```

**Arreglo que funcionó**: abrir **Visual Studio Installer** (ya queda instalado) → sección
"Visual Studio Build Tools 2022" → botón **Modificar** → marcar **"Desktop development with
C++"** → Modificar, y esperar a que instale (varios GB). Confiar en la interfaz gráfica acá,
no en reintentar el flag de `winget`.

---

## 1. PostgreSQL 16

Instalador de la web oficial. Anotar la contraseña del usuario `postgres` (superusuario).
Después, crear el usuario y la base de la app (`psql` o pgAdmin):

```sql
CREATE USER pos WITH PASSWORD 'una-clave-larga';
CREATE DATABASE pos OWNER pos;
```

---

## 2. Transferir el código del proyecto a la máquina

Si es una VM de prueba en QEMU/libvirt con SPICE: **arrastrar y soltar la carpeta directo
desde el explorador de archivos del host a la ventana de la VM** funcionó de una — mucho
más simple que armar un túnel de red.

**Lo que NO funcionó y no vale la pena intentar de nuevo**: servir el proyecto por HTTP
(`python -m http.server`) para bajarlo con `Invoke-WebRequest` desde la VM. Si la VM quedó en
una red tipo `192.168.122.0/24` (NAT por defecto de libvirt, `virbr0`) o en un macvtap bridge,
en ningún caso la VM pudo hablarle de vuelta al host — es una limitación de red, no de
firewall (aunque también hubo que abrir un puerto con `ufw` antes de descartar esa vía).
Ir directo al arrastre.

---

## 3. Node.js + pnpm

Node.js 22 LTS desde la web oficial (incluye `npm`).

```powershell
corepack enable
```

**Gotcha real**: si esta PowerShell no es de Administrador, tira:

```
Internal Error: EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpx'
```

**Arreglo**: cerrar y abrir PowerShell **como administrador** sólo para este comando. El resto
de los pasos no necesita administrador.

Después, al primer `pnpm install` (o cualquier `pnpm ...`):

```
No se puede cargar el archivo ...\pnpm.ps1 porque la ejecución de scripts está deshabilitada
```

**Arreglo** (una sola vez, con PowerShell normal, sin admin):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 4. `pnpm install` en el proyecto

```powershell
cd C:\pos-desktop
pnpm install
```

Con Python y VS Build Tools ya instalados (paso 0), esto compila `better-sqlite3` dos veces:
una para el Node normal de Windows, y otra para el ABI de Electron (vía el `postinstall`
`electron-builder install-app-deps`, que corre automático al final de `pnpm install`). Si
falla acá, revisar el paso 0 antes que nada — casi siempre es Python o el workload de C++.

---

## 5. Migraciones de PostgreSQL

**No correr `pnpm db:generate:pg` en el servidor.** Las migraciones ya vienen generadas en
`resources/migrations-pg/` (y en `dist-server/` cuando se hace `pnpm build:server`). El
servidor las aplica solo al arrancar (`initDb`), y el script de migración de datos también.

Si sólo querés confirmar que el esquema del código coincide con lo generado, en la máquina de
desarrollo: `pnpm db:generate:pg` no debería crear ningún archivo nuevo.

> La migración `0005-pg` convierte los importes de coma flotante a enteros de centavos con
> `ALTER COLUMN … USING round(x * 100)`. Se aplica sobre tablas vacías en un despliegue nuevo;
> sobre datos existentes convierte los valores. No hay acción manual.

---

## 6. Verificar contra PostgreSQL real

**Gotcha importante, ya corregido en `docs/fase-2-migracion.md` y en el código, pero
documentado acá por si se repite en otra copia vieja del proyecto**: `verify:backend:pg` NO
sirve para esto — trae `DATABASE_URL=pglite://memory` fijo adentro del propio script
(`cross-env` lo pisa siempre, sin importar lo que pongas antes en la terminal). Usar
**`verify:backend`** (sin `:pg`):

```powershell
$env:DATABASE_URL = "postgres://pos:una-clave-larga@localhost:5432/pos"
pnpm verify:backend
```

**Otro gotcha real**: a diferencia de SQLite/PGlite (arrancan de un archivo temporal/memoria
nueva cada corrida), este PostgreSQL persiste entre corridas. Si corrés `verify:backend` una
segunda vez contra la misma base, va a fallar por datos que dejó la corrida anterior (más
categorías/productos de los que el test espera al arrancar). Antes de cada corrida de prueba
repetida, vaciar la base (conectado como `postgres`, no como `pos`):

```sql
DROP DATABASE pos;
CREATE DATABASE pos OWNER pos;
```

Esto es sólo para pruebas repetidas — en el despliegue real se corre una sola vez, recién
migrada la base, así que no aplica ahí.

Con todo esto, las ~145 comprobaciones deberían pasar en verde contra el PostgreSQL real.

---

## 6. Servidor standalone (Día 3) — pendiente de probar en VM

En la máquina de desarrollo:

```bash
pnpm build:server        # genera dist-server/ (ya incluye resources/migrations-pg)
```

Arrastrar `dist-server/` a `C:\pos-server` en la máquina servidor.

```powershell
cd C:\pos-server
copy .env.example .env
npm install --omit=dev
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

### `.env` — el servidor ABORTA el arranque si falta algo (validación nueva)

```ini
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgres://pos:una-clave-larga@localhost:5432/pos   # obligatorio, no pglite://
POS_DATA_DIR=C:\pos-server\data
POS_VENDOR_SECRET=<secreto-real-de openssl rand -base64 32>       # obligatorio, no el de ejemplo
# POS_ADMIN_PASSWORD=<mín. 8 chars>   # opcional; si se omite se genera al azar
```

**Errores de arranque esperados si el `.env` está mal** (aparecen en `pm2 logs pos-server`):

```
❌ El servidor no puede arrancar en producción:
   - DATABASE_URL no está definida. La Fase 2 requiere PostgreSQL ...
   - POS_VENDOR_SECRET no configurado, o es un valor público/de ejemplo conocido ...
```

(para una prueba local rápida se puede forzar el arranque con `POS_ALLOW_INSECURE=1`, que
además siembra un `cajero` de prueba — **nunca en la PC del cliente**).

### Contraseña de `admin` en el primer arranque

Si no se puso `POS_ADMIN_PASSWORD`, el servidor la genera al azar y la imprime **una sola
vez**. Recuperarla:

```powershell
pm2 logs pos-server --lines 50
```

Buscar el bloque `POS SpArTaN Tech — usuario administrador inicial`. Ya no se crea el usuario
`cajero / cajero123` en producción.

### Rotación de logs de pm2

```powershell
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

### Servicio de Windows

```powershell
npm install pm2-installer --no-save
npm run configure
npm run setup
```

Después: **Día 4** (IP fija, firewall del puerto 3000, y TLS opcional con `mkcert` +
`POS_TLS_KEY`/`POS_TLS_CERT` — ver [`fase-2-migracion.md`](fase-2-migracion.md)) y **Día 5**
(QA multicajero: folios únicos, socket autenticado, cierres de caja al centavo).

### Licencia en el servidor

El servidor de Fase 2 sirve la misma SPA, así que también pide **activar licencia** la
primera vez — con el fingerprint de la PC servidor, generando la clave con
`pnpm license:gen` y el **mismo `POS_VENDOR_SECRET` real** del `.env`. La activación está
limitada a 5 intentos fallidos por minuto y por IP.

### Respaldo de PostgreSQL

Programar `backup-pg.ps1` (script completo con timestamp ISO, verificación y retención en
[`fase-2-migracion.md`](fase-2-migracion.md) → "Respaldo de PostgreSQL"). El `pg_dump` con
`%DATE%` del runbook viejo no sirve (locale de Windows).
