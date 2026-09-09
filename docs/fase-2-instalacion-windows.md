# Fase 2 — Checklist real de instalación en Windows

Complemento de [`docs/fase-2-migracion.md`](fase-2-migracion.md) (el runbook por días). Este
archivo documenta los pasos **tal como pasaron de verdad** en una VM de prueba (Windows 11),
con los errores concretos que salieron y cómo se resolvieron — para no repetirlos en la PC
real del cliente.

**Estado: Día 1 y Día 2 completos y verificados. Día 3 en adelante, pendiente — retomar ahí.**

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

```powershell
$env:DATABASE_URL = "postgres://pos:una-clave-larga@localhost:5432/pos"
pnpm db:generate:pg
```

(No hace falta si `resources/migrations-pg/` ya viene generado en el código que arrastraste —
sólo confirma que no hay cambios de esquema pendientes.)

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

## Pendiente (retomar con "sigamos" o "seguimos")

Seguir con el **Día 3** de [`docs/fase-2-migracion.md`](fase-2-migracion.md):
`pnpm build:server` (en la máquina de desarrollo) → arrastrar `dist-server/` a
`C:\pos-server` en la máquina servidor → configurar `.env` (`DATABASE_URL`,
`POS_VENDOR_SECRET` real) → `npm install --omit=dev` → `npm install -g pm2` →
`pm2 start ecosystem.config.cjs` → `pm2 save` → `pm2-installer` (servicio de Windows).
Después Día 4 (red/firewall) y Día 5 (QA multicajero).

Recordar: el servidor de Fase 2 sirve la misma SPA, así que también va a pedir **activar
licencia** la primera vez — con el fingerprint de la PC servidor, generando la clave con
`pnpm license:gen` y el mismo `POS_VENDOR_SECRET` real.
