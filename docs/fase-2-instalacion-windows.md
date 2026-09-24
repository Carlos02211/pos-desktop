# Fase 2 — Instalación del servidor en Windows

Guía concreta para instalar el **servidor** de Fase 2 en la PC del cliente (o una VM de
prueba). Runbook conceptual por días: [`fase-2-migracion.md`](fase-2-migracion.md).

> **Lo que va a la PC del cliente es UNA sola carpeta: `pos-server/`** (el resultado de
> `pnpm build:server`, renombrado). Es autocontenida. **No** hace falta clonar el repo, ni
> `pnpm`, ni Python, ni Visual Studio Build Tools — el bundle no tiene módulos nativos.

---

## Parte A — En la máquina de desarrollo (una vez, o en cada actualización)

```bash
pnpm install
pnpm build:server        # → genera dist-server/
```

`dist-server/` contiene y nada más:

| Archivo / carpeta      | Qué es                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| `server.cjs`           | el servidor (bundle único)                                                  |
| `public/`              | la app web (React) que se sirve a las tabletas                              |
| `migrations-pg/`       | migraciones de PostgreSQL (se aplican solas al arrancar)                    |
| `package.json`         | dependencias de runtime (sin `better-sqlite3` → sin compilador)             |
| `env-ejemplo.txt`      | plantilla del `.env` (nombre visible: los `.archivos` se pierden al copiar) |
| `ecosystem.config.cjs` | configuración de pm2                                                        |
| `setup-server.ps1`     | instalación idempotente (Node, `npm install`, pm2, firewall)                |
| `backup-pg.ps1`        | respaldo programado de PostgreSQL                                           |
| `LEEME.txt`            | resumen de lo anterior                                                      |

Renombrar `dist-server/` → `pos-server/` y pasarla a la PC del cliente (USB, o
arrastre por SPICE si es una VM). **Nada más del repo.**

---

## Parte B — En la PC del cliente / VM (Windows 10/11 x64)

### B1. PostgreSQL 16

Instalador de <https://www.postgresql.org/download/windows/>. Anotar la contraseña del
superusuario `postgres`. Dejar `listen_addresses = 'localhost'` en `postgresql.conf` (sólo
la app local habla con la base; las tabletas nunca tocan PostgreSQL).

Crear la base y el usuario de la app — abrir **SQL Shell (psql)** del menú inicio:

```sql
CREATE USER pos WITH PASSWORD 'una-clave-larga';
CREATE DATABASE pos OWNER pos;
```

### B2. (Sólo si se migran datos de Fase 1)

Desde la máquina de desarrollo, con la última `pos.db`:

```bash
DATABASE_URL=postgres://pos:una-clave-larga@localhost:5432/pos \
  pnpm migrate:sqlite-to-pg -- --source "C:\ruta\a\pos.db"
```

El script aplica las migraciones, copia los datos convirtiendo importes a centavos, y
**verifica** las sumas de control (aborta con ROLLBACK si algo no cuadra). Instalación
nueva sin datos previos: saltear este paso.

### B3. Copiar `pos-server/` y configurar el `.env`

Copiar la carpeta a `C:\pos-server`. Crear el `.env` (o dejar que `setup-server.ps1` lo cree
desde la plantilla y lo abra en el Bloc de notas la primera vez):

```powershell
cd C:\pos-server
copy env-ejemplo.txt .env
notepad .env
```

Mínimo a completar (**el servidor no arranca si falta alguno**):

```ini
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgres://pos:una-clave-larga@localhost:5432/pos
POS_DATA_DIR=C:\pos-server\data
# POS_ADMIN_PASSWORD=<opcional, mín. 8 chars; si se omite se genera al azar>
```

### B4. Instalar y arrancar

**PowerShell como Administrador**, en `C:\pos-server`:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-server.ps1
```

El script, de forma idempotente:

1. instala **Node.js 22 LTS** con `winget` si no está (el bundle no necesita compilador);
2. `npm install --omit=dev` (rápido, sin `node-gyp`);
3. `npm install -g pm2`, `pm2 start ecosystem.config.cjs`, `pm2 save`, `pm2-logrotate`;
4. abre el puerto TCP en el firewall (perfil Privado);
5. comprueba `http://localhost:3000/api/ping`.

**Contraseña de `admin`** (sólo el primer arranque, si no pusiste `POS_ADMIN_PASSWORD`):

```powershell
pm2 logs pos-server --lines 50
```

Buscar el bloque `POS SpArTaN Tech — usuario administrador inicial`. No se vuelve a mostrar;
cambiarla al primer login. En producción **no** se crea el usuario `cajero` de prueba.

### B5. Arranque automático al encender la PC (servicio de Windows)

```powershell
cd C:\pos-server
npm install pm2-installer --no-save
npm run configure
npm run setup
```

### B6. Activar la licencia

El servidor sirve la misma SPA, así que la primera vez pide **activar licencia**. Abrir
`http://localhost:3000/`, copiar el _ID de este equipo_ y generar la clave en la máquina del
proveedor (firma con la clave privada de `~/.config/spartan-pos/license-private.pem`):

```bash
pnpm license:gen <ID>
```

La clave es larga (~103 caracteres en grupos de 5): mandarla por WhatsApp/correo y **pegarla**
completa. Pegar la clave y activar. (5 intentos fallidos por minuto y por IP.)

La PC del cliente sólo tiene la clave **pública** (embebida en `server.cjs`): aunque alguien
lea el `.env` o el bundle, no puede generar claves para otros equipos. Si cambia el hardware
o el **nombre del equipo**, cambia el ID y hay que emitir una clave nueva.

### B7. Red y tabletas

- **IP fija** para la PC servidor en el router (reserva DHCP), p. ej. `192.168.1.10`.
- El firewall ya lo abrió `setup-server.ps1`.
- En cada tableta: abrir `http://192.168.1.10:3000/` en Chrome, "Agregar a pantalla de inicio".
- **HTTPS (recomendado si van por WiFi)**: `mkcert` + `POS_TLS_KEY`/`POS_TLS_CERT` en el
  `.env` + importar la CA de mkcert en cada tableta. Ver
  [`fase-2-migracion.md`](fase-2-migracion.md) → "Día 4".

### B8. Respaldo

Editar las 4 variables de `C:\pos-server\backup-pg.ps1` y programarlo (diario). Ver
[`fase-2-migracion.md`](fase-2-migracion.md) → "Respaldo de PostgreSQL".

---

## Verificar la API contra el PostgreSQL real (opcional, en dev)

Desde la máquina de desarrollo, apuntando a la base del cliente (o una local):

```powershell
$env:DATABASE_URL = "postgres://pos:...@localhost:5432/pos"
pnpm verify:backend        # NO `:pg` — ese trae DATABASE_URL=pglite fijo adentro
```

~156 comprobaciones en verde. El CI ya corre esto en cada push contra un PostgreSQL 16 real.

Este PostgreSQL persiste entre corridas: para repetir la prueba, `DROP DATABASE pos; CREATE
DATABASE pos OWNER pos;` (como `postgres`) antes de cada una.

---

## Gotchas reales encontrados en la VM (Windows 11)

- **`Set-ExecutionPolicy`**: PowerShell bloquea los scripts `.ps1` por defecto.
  `setup-server.ps1` se corre con `-Scope Process Bypass` (no persiste el cambio).
- **`corepack enable` pide admin** (`EPERM ... nodejs\pnpx`) — sólo relevante en la máquina
  de desarrollo (el cliente usa `npm`, no `pnpm`).
- **Transferir archivos a una VM**: el arrastre-soltar por SPICE (QEMU/libvirt) funcionó de
  una; servir por HTTP para bajar con `Invoke-WebRequest` NO (la VM en NAT `virbr0` no puede
  hablarle de vuelta al host).
- **Python / VS Build Tools: YA NO hacen falta** para el servidor (el bundle no tiene
  `better-sqlite3`). Sólo se necesitan en la máquina de desarrollo si además se compila el
  `.exe` de Fase 1.
