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
| `ip-fija.ps1`          | fija la IP de la PC servidor (B7)                                           |
| `setup-https.ps1`      | HTTPS en la red local con mkcert (B7)                                       |
| `backup-pg.ps1`        | respaldo manual (los automáticos los hace el servidor, B8)                  |
| `LEEME.txt`            | resumen de lo anterior                                                      |

Renombrar `dist-server/` → `pos-server/` y pasarla a la PC del cliente (USB, o
arrastre por SPICE si es una VM). **Nada más del repo.**

---

## Parte B — En la PC del cliente / VM (Windows 10/11 x64)

Llevar una copia de la [**ficha del cliente**](ficha-cliente.md) e ir llenándola: IP, licencia,
vencimiento del certificado, respaldos y la lista de verificación de entrega.

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

[pm2-installer](https://github.com/jessety/pm2-installer) crea el servicio de Windows **pm2**,
que corre como _Servicio local_ y levanta el POS al encender la PC, **antes de que nadie
inicie sesión**. Se descarga como carpeta aparte (no es una dependencia del POS).

> En una instalación nueva conviene hacer este paso **antes de B4**: así `setup-server.ps1`
> registra el POS directamente en el pm2 del servicio. Si B4 ya se hizo, empezar por apagar
> el pm2 del usuario (primer bloque).

PowerShell **como Administrador**:

```powershell
# Sólo si B4 ya se hizo: apagar el pm2 del usuario (pm2.cmd evita el bloqueo de scripts)
pm2.cmd kill
npm uninstall -g pm2

# Descargar pm2-installer e instalar el servicio
cd C:\
Invoke-WebRequest https://github.com/jessety/pm2-installer/archive/refs/heads/main.zip -OutFile C:\pm2-installer.zip
Expand-Archive C:\pm2-installer.zip -DestinationPath C:\
cd C:\pm2-installer-main
npm run configure          # npm global -> C:\ProgramData\npm (visible para el servicio)
npm run configure-policy   # permite scripts: ya no hace falta el Bypass
npm run setup              # instala pm2 + servicio "pm2" + @jessety/pm2-logrotate

# El servicio (Servicio local, SID S-1-5-19 — el nombre cambia según el idioma de
# Windows) necesita leer C:\pos-server y escribir en data\
icacls C:\pos-server /grant "*S-1-5-19:(OI)(CI)M" /T
```

**Cerrar PowerShell y abrir uno nuevo como Administrador** (toma `PM2_HOME` =
`C:\ProgramData\pm2\home`) y registrar el POS en el pm2 del servicio:

```powershell
cd C:\pos-server
.\setup-server.ps1
Get-Service pm2      # Running
pm2 ls               # pos-server online
```

Prueba: reiniciar la PC **sin iniciar sesión** y abrir `http://<IP>:3000/api/ping` desde
otro equipo de la red.

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

### B7. Red: IP fija, perfil Privado y HTTPS

El certificado HTTPS se emite para una IP concreta, así que el orden es **IP fija → HTTPS**.
Todo en PowerShell **como Administrador**, en `C:\pos-server`, frente a la PC (no por
escritorio remoto: al cambiar la IP se corta la conexión).

**1. IP fija.** Cada proveedor (izzi, Telmex/Infinitum, Totalplay, Megacable…) usa su
propia red y su propio rango de IPs automáticas (DHCP), así que **no hay una IP que sirva
siempre**: se elige en cada negocio.

1. **Ver la red actual** en la PC servidor: `ipconfig`. Anotar la **Dirección IPv4** (la IP
   que tiene ahora) y la **Puerta de enlace predeterminada** (la IP del router).
2. **Entrar al router**: abrir `http://<puerta de enlace>` en el navegador de esa PC. Usuario
   y contraseña suelen estar en la **etiqueta del módem**; si no, los da el proveedor. Algunos
   módems de proveedor vienen con opciones limitadas: si no se puede entrar o no hay opción
   de DHCP, pedirlo al soporte del proveedor o usar la opción 1 de abajo igual (con la IP
   actual) sabiendo que el riesgo de choque es bajo pero existe.
3. **Buscar la sección LAN / DHCP** (el nombre varía: "Red local", "LAN Setup", "DHCP
   Server", "Configuración de LAN"…). Ahí se ve el **rango DHCP** (IP inicial y final que el
   router reparte solo). Elegir **una** de dos:
   - **Reserva DHCP (recomendada si el router la tiene):** "Reserva de direcciones", "Static
     Lease", "IP estática por MAC"… asignar a esta PC su IP actual (la MAC aparece en la lista
     de equipos conectados, o con `ipconfig /all` → "Dirección física").
   - **IP fuera del rango DHCP:** elegir una IP de la misma red que **no** esté dentro del rango
     que reparte el router ni la use otro equipo (mismos tres primeros números que la puerta de
     enlace; el último, fuera del rango).
4. **Fijarla en Windows** (PowerShell como Administrador, en `C:\pos-server`):

```powershell
.\ip-fija.ps1                  # opción reserva DHCP: fija la IP que ya tiene
.\ip-fija.ps1 -Ip <IP elegida> # opción fuera de rango
.\ip-fija.ps1 -VolverADhcp     # deshacer
```

El script propone la puerta de enlace y los DNS actuales, muestra todo y pide confirmar.

**2. Perfil de red Privado.** La regla del firewall es para el perfil Privado; si Windows
marcó la red como **Pública**, bloquea a las cajas. `setup-server.ps1` lo avisa al final. Para
cambiarlo: `Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private`.

**3. HTTPS** (recomendado si hay cajas/tabletas por WiFi; además lo exigen algunas funciones
del navegador y la instalación como app):

```powershell
.\setup-https.ps1
```

Instala mkcert, crea una **CA local propia de esta PC** (Windows pide confirmar: "Sí"),
emite el certificado para la IP, escribe `POS_TLS_KEY` / `POS_TLS_CERT` / `POS_TLS_CA` en el
`.env`, reinicia el servidor y muestra la **fecha de vencimiento** (~2 años — anotarla; el
log del servidor avisa 60 días antes). Para renovar, o si cambia la IP: volver a correrlo
**con el mismo usuario de Windows** (la clave de la CA queda en su carpeta de mkcert, fuera
de `C:\pos-server`).

**4. En cada caja / tableta, una sola vez:** abrir `https://<IP>:3000/ca.crt` (el navegador
avisa "no seguro" porque todavía no confía: continuar) e instalar el certificado:

- **Android:** Ajustes → Seguridad → Más ajustes → Cifrado y credenciales → Instalar un
  certificado → Certificado de CA → `CA-POS-SpArTaN.crt`.
- **iPhone/iPad:** instalar el perfil descargado y luego Ajustes → General → Información →
  Ajustes de confianza de certificados → activarlo.
- **Windows:** doble clic al `.crt` → Instalar certificado → Equipo local → "Entidades de
  certificación raíz de confianza".

Después, `https://<IP>:3000/` abre sin avisos. Las URLs `http://` dejan de funcionar.

**Checklist de red del cliente:** IP fija ✔ · red Privada ✔ · las tabletas en la red
principal, no en la de **invitados** (muchos routers aíslan a los dispositivos entre sí) ✔.

**Vencimiento del certificado.** Son dos certificados distintos:

| Certificado                            | Dónde está                     | Dura                         |
| -------------------------------------- | ------------------------------ | ---------------------------- |
| CA local (autoridad de mkcert)         | instalada en cada caja/tableta | 10 años                      |
| Certificado del servidor (el de la IP) | sólo en la PC servidor         | ~2 años y 3 meses (825 días) |

Sólo el del servidor vence en la práctica, y **se renueva solo**: `setup-https.ps1` registra
la tarea programada **"POS SpArTaN Tech - renovar certificado"** (lunes 3:00, como SYSTEM; si
la PC estaba apagada, corre al encenderla). Si faltan menos de 60 días, emite un certificado
nuevo con la **misma CA** — **las tabletas no se tocan** — y reinicia el servidor. Cada
ejecución queda en `C:\pos-server\data\logs\renovar-certificado.log`.

- Probarla: `.\renovar-certificado.ps1 -Forzar` (renueva ya) o ejecutar la tarea desde el
  Programador de tareas.
- No se puede emitir por más tiempo: iPhone/iPad rechazan certificados de servidor de más
  de 825 días.
- Si aun así venciera (p. ej. se borró la tarea), las cajas ven "La conexión no es privada":
  volver a correr `.\setup-https.ps1`. El log del servidor avisa 60 días antes.

**¿Qué pasa si se va el internet?** Nada: el POS funciona **sin internet**. Todo ocurre dentro
de la red local (servidor, base de datos, licencia y HTTPS son locales; la app no carga
nada de fuera). Lo que sí hace falta es que **el router/módem y el switch sigan encendidos**,
porque es por donde se comunican las cajas con el servidor aunque no haya servicio del
proveedor. Si se corta la **luz**, se cae todo: recomendado un **no-break (UPS)** para la PC
servidor **y** el módem/router. Internet sólo se usa durante la instalación (winget, npm,
mkcert, pm2-installer).

### B8. Respaldos

**Automáticos, sin configurar nada:** el servidor respalda la base con `pg_dump` al
**cerrar cada caja** y **una vez al día** (aunque ese día no se cierre caja). Guarda los
últimos 30 y verifica cada uno. No hace falta ninguna tarea programada.

**Elegir dónde se guardan** (recomendado: **otro disco o una USB**, para que un respaldo
sobreviva si falla el disco principal): Admin → Configuración → Respaldos → **Cambiar…**.
Se navegan las carpetas **de la PC servidor** (también se puede crear una nueva); al elegir,
el sistema comprueba que puede escribir ahí y la guarda. **Respaldar ahora** hace uno en el
momento y la sección muestra el último respaldo y si alguno falló.

Si al elegir una carpeta dice que **no tiene permiso** (el servidor corre como "Servicio
local"), darle permiso en la PC servidor — PowerShell como Administrador:

```powershell
icacls "<carpeta elegida>" /grant "*S-1-5-19:(OI)(CI)M"
```

`pg_dump` se busca solo en `C:\Program Files\PostgreSQL\<versión>\bin`. Si PostgreSQL está
en otra ruta, agregar `POS_PG_DUMP=<ruta a pg_dump.exe>` al `.env`.

**Respaldo manual** (p. ej. antes de actualizar, aunque el servidor esté detenido):
`.\backup-pg.ps1` (o `.\backup-pg.ps1 -Destino "<carpeta>"`). Lee todo del `.env`.

**Restaurar** un respaldo (`pos_<fecha>.dump`) — PowerShell como Administrador:

```powershell
pm2 stop pos-server
$pg = (Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin").FullName | Select-Object -Last 1
& "$pg\dropdb.exe"   -U postgres pos
& "$pg\createdb.exe" -U postgres -O pos pos
& "$pg\pg_restore.exe" -U postgres -d pos --no-owner --role=pos "<ruta>\pos_<fecha>.dump"
pm2 start pos-server
```

(pide la contraseña del usuario `postgres`). Probar una restauración **una vez** en cada
instalación nueva: un respaldo que nunca se restauró no está probado.

### B9. Impresora de tickets

Admin → Configuración → **Impresora de tickets**. Los tickets salen por esa impresora sin
importar desde qué caja o tableta se cobre.

**¿El negocio usa impresora?** Por defecto **No**: las ventas se registran sin imprimir y la
caja no muestra ningún aviso (tampoco aparece "Reimprimir ticket"). Cuando consigan
impresora, elegir **Sí**, configurarla como se indica abajo y **Guardar cambios**. Volver a
**No** (p. ej. si se descompone) **conserva** la conexión configurada, para reactivarla igual.
Con la impresora en **Sí**, el aviso "Ticket no impreso" en la caja sí indica una falla real.

- **Conectada a la PC servidor (USB):** instalar primero el **driver del fabricante** (p. ej.
  Xprinter) en la PC servidor; luego elegirla de la lista (botón ⟳ para actualizarla). El
  ticket se manda directo a la cola de impresión de Windows, así que funciona aunque el
  servidor corra como servicio.
- **Impresora de red (cable o WiFi):** poner su IP y el puerto (casi siempre 9100). La IP se
  ve imprimiendo la **hoja de autoprueba** (con la impresora apagada, mantener FEED y
  encenderla). Conviene reservarle esa IP en el router, igual que al servidor.
- **Imprimir hoja de prueba** confirma conexión y corte de papel **antes de guardar**; si
  falla, dice qué revisar. Después, **Guardar cambios**.

Si la impresora falla durante el día, las ventas se registran igual y la caja ve el aviso de
que el ticket no salió (se puede reimprimir desde Ventas).

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
