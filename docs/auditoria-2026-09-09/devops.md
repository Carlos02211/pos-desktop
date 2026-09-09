# Auditoría DevOps / Infraestructura / Build — pos-desktop (READ-ONLY)

Fecha: 2026-09-09 · Rama: `main` · Árbol de trabajo: **sucio** (38 modificados + 13 sin seguir)
Alcance: `electron-builder.yml`, `tsup.config.ts`, `scripts/`, `deploy/`, `src/server/`, `docs/fase-2-*`, CI/CD, observabilidad, secretos, estado del repo.

---

## Resumen por severidad

| Sev | # | Título |
|-----|---|--------|
| Crítico | C1 | Archivos críticos para build y runtime SIN commitear (check-vendor-secret, 7 migraciones) |
| Crítico | C2 | El servidor standalone NO valida `POS_VENDOR_SECRET` (cae a secreto de dev) |
| Alto | A1 | Instalador NSIS sin firma de código |
| Alto | A2 | Sin mecanismo de auto-update (`publish: null`, sin electron-updater) |
| Alto | A3 | Sin CI/CD; builds manuales no reproducibles; Node/pnpm sin pin efectivo |
| Alto | A4 | CORS `origin:true` + `credentials:true` + login sin rate-limit + credenciales por defecto |
| Alto | A5 | Backups de PostgreSQL: sólo un `pg_dump` manual frágil, sin rotación/retención/restore |
| Medio | M1 | `scripts/sqlite-to-postgres.ts`: transacciones por tabla, sin backup previo, sin rollback global |
| Medio | M2 | `electron-builder.yml` usa denylist (`!src/*`) — empaqueta fuente TS y config |
| Medio | M3 | pm2 sin rotación de logs, sin monitor externo, sin alerta tras `max_restarts` |
| Medio | M4 | Sin TLS entre tabletas y servidor (passwords + JWT en claro por LAN) |
| Medio | M5 | `server.cjs.map` (sourcemap completo) se despliega a producción |
| Medio | M6 | `electron-store`: `encryptionKey` hardcodeado + `clearInvalidConfig` borra licencia/JWT |
| Medio | M7 | Runbook Fase 2 frágil y no probado end-to-end (drag&drop, pasos manuales, "Día 3 pendiente") |
| Medio | M8 | `electron-store` ESM-only requerido desde bundle CJS — depende de Node ≥20.19/22 |
| Bajo | B1 | Drift de nombres en comentarios (`build-server.mjs` vs `.ts`) |
| Bajo | B2 | `VENDOR_SECRET` embebido en claro en el asar (inherente al esquema offline) |
| Bajo | B3 | Parser `.env` casero en `src/server/config.ts` (sin multilínea/escape) |
| Bajo | B4 | `dist-server/` sin versionado/checksum del artefacto desplegado |
| Bajo | B5 | Sin opción de contenedor para el servidor (reproducibilidad) |

---

## Crítico

### C1 — Archivos imprescindibles para build y runtime sin commitear
`git status` (raíz) — sin seguimiento:
- `scripts/check-vendor-secret.ts` → lo invoca `package.json:25` (`build:win`). **Un clon limpio NO puede correr `pnpm build:win`** (falla por archivo inexistente).
- `resources/migrations/0002_slippery_runaways.sql`, `0003_wonderful_gabe_jones.sql`, `0004_next_marauders.sql` (+ `meta/000{2,3,4}_snapshot.json`)
- `resources/migrations-pg/0001_nice_william_stryker.sql`, `0002_mature_hiroim.sql`, `0003_pale_franklin_richards.sql` (+ snapshots)
- `resources/migrations*/meta/_journal.json` están **modificados** pero los SQL nuevos no están: el journal y los archivos quedarían inconsistentes en un commit parcial.

Impacto: el esquema de BD que se aplica en runtime (`extraResources` en Electron, copia en `scripts/build-server.ts:35-36`) está **incompleto en git**. Un `git stash`, `git checkout` o clon pierde 3 migraciones SQLite + 3 PostgreSQL y el guard de secreto. Además el árbol tiene 38 archivos modificados sin commit tras dos merges de Fase 2 → esta auditoría evalúa un estado que no existe en el historial.

Recomendación: `git add -A` de migraciones + `check-vendor-secret.ts`, commitear Fase 2 en piezas coherentes, y añadir un check de "árbol limpio + migraciones = journal" al pipeline. Verificar que `resources/migrations*/meta/_journal.json` liste exactamente los SQL presentes.

### C2 — El servidor standalone no exige `POS_VENDOR_SECRET`
- `deploy/.env.example:22` afirma: *"Sin este valor (o con el de ejemplo) el servidor no arranca."* — **es falso.**
- `src/server/index.ts` / `src/server/config.ts`: no hay ninguna comprobación de `POS_VENDOR_SECRET`.
- `src/main/services/license.ts:37-47`: si falta o es un valor conocido, usa `DEV_ONLY_SECRET` y sólo hace `console.warn`.
- `package.json:26` (`build:server`) y `scripts/build-server.ts:31-32` **no** ejecutan `check-vendor-secret.ts` (sólo `build:win` lo hace).

Impacto: un servidor de Fase 2 desplegado sin exportar el secreto (fácil: el `.env` trae el placeholder, que además está en `KNOWN_LEAKED_SECRETS`) queda firmando/validando licencias con el secreto de desarrollo público → cualquiera puede falsificar licencias para cualquier equipo. El operador sólo ve un warning enterrado en los logs de pm2 (nivel `warn`, sin agregación).

Recomendación: en `src/server/config.ts` (o `index.ts`) abortar el arranque si `POS_VENDOR_SECRET` está ausente, es corto o está en `KNOWN_LEAKED_SECRETS` — reutilizar la lógica de `check-vendor-secret.ts`. Añadir `tsx scripts/check-vendor-secret.ts` al principio de `build:server`.

---

## Alto

### A1 — Instalador sin firma de código
`electron-builder.yml:30-49`: bloque `win`/`nsis` sin `certificateFile`/`certificateSubjectName`/`signtoolOptions`/`azureSignOptions`. `publish: null`.
Impacto: SmartScreen/Defender bloquea o advierte en cada instalación; el cliente no puede verificar autenticidad ni integridad; un binario manipulado en tránsito (se copia por USB/drag&drop, ver `docs/fase-2-instalacion-windows.md:54-66`) es indetectable. Sin firma, un futuro auto-update sería inseguro.
Recomendación: adquirir un certificado (OV o EV/Azure Trusted Signing) y firmar en el pipeline; documentar el hash SHA-256 del `.exe` publicado.

### A2 — Sin auto-update ni canal de parches
No hay `electron-updater` en dependencias, `publish: null`, no existe `dev-app-update.yml`, `grep autoUpdater src/main` vacío.
Impacto: cada corrección (de un POS que maneja dinero) exige reinstalar manualmente en cada PC/tableta y en el servidor; sin rollback; sin forma de saber qué versión corre cada cliente.
Recomendación: definir estrategia — como mínimo un endpoint de "versión mínima" que el cliente consulte y muestre aviso; idealmente `electron-updater` con `publish` a un bucket/servidor propio + instaladores firmados.

### A3 — Sin CI/CD; builds no reproducibles
No existe `.github/` ni ningún workflow. `docs/empaquetado-e-instalacion.md` y `docs/fase-2-instalacion-windows.md` describen builds hechos a mano en un portátil y "arrastrados" a una VM.
- Node no está pinneado: no hay `.nvmrc`/`.node-version`; `package.json:10-12` sólo `node>=20`; el runbook mezcla "Node 20.19+ o 22"; `tsup.config.ts:15` apunta a `node20`.
- `scripts/build-server.ts:107` documenta que `better-sqlite3` se **recompila en el servidor** con el Node que haya allí → riesgo de ABI mismatch si difiere del de build.
- Sin gate de tests: `pnpm verify:backend` (harness de ~145 checks, `scripts/verify-backend.ts`) no corre automáticamente en ningún lado.
Recomendación: GitHub Actions con matriz (build Windows para el `.exe` firmado, build Linux para `dist-server`), `pnpm` con `--frozen-lockfile`, Node pinneado vía `.nvmrc`, y `verify:backend:pg` + `typecheck` + `lint` como gate obligatorio en PR.

### A4 — Superficie de red del servidor Fase 2
- `src/main/server.ts:67-70`: `cors({ origin: opts.allowedOrigins ?? true, credentials: true })`. `src/server/config.ts:50-52`: `allowedOrigins` es `true` si no se define `POS_ALLOWED_ORIGINS`, y el runbook (`docs/fase-2-migracion.md:149-151`) dice explícitamente que "normalmente no hace falta". `origin:true` refleja cualquier Origin → cualquier web que abra el cajero puede llamar a la API de la LAN desde el navegador (riesgo de DNS-rebinding; `credentials:true` con reflexión es un antipatrón).
- `src/main/socket.ts:13-19`: Socket.io con el mismo CORS abierto y **sin autenticación** (`// En Fase 2 aquí se autenticará` — TODO sin implementar). Cualquiera en la LAN recibe todos los eventos de negocio en tiempo real.
- `src/main/routes/auth.ts:14-17`: `/api/auth/login` **sin rate-limit** (sólo `license.ts` tiene throttle). Fuerza bruta libre.
- `src/main/db/seed.ts:33-45`: siembra siempre `admin/admin123` y `cajero/cajero123`; el runbook de Fase 2 (Días 3-5) nunca menciona cambiarlas ni deshabilitar el cajero de prueba. Documentadas en `docs/guia-cobrador.html:431`.
Impacto: servidor en `0.0.0.0:3000` sin TLS, con credenciales conocidas y login sin freno = compromiso trivial desde cualquier dispositivo de la red (o red WiFi de invitados si comparte VLAN).
Recomendación: exigir `POS_ALLOWED_ORIGINS` explícito (fallar si vacío en producción), lista blanca real en CORS y Socket.io, autenticar el socket con el JWT, rate-limit en `/api/auth/login` (p.ej. `@fastify/rate-limit`), forzar cambio de contraseña de `admin` en el primer login y no sembrar `cajero` de prueba en producción.

### A5 — Backups de PostgreSQL
`docs/fase-2-migracion.md:167-172`: única mención = un `pg_dump -U pos -Fc pos > C:\pos-server\backups\pos_%DATE%.dump` en el Programador de tareas.
Problemas: `%DATE%` depende de la configuración regional de Windows (produce nombres con `/` o espacios → archivo inválido o ruta rota); sin retención/rotación (el disco se llena); sin verificación de que el dump no está corrupto; sin prueba de restauración documentada; sin copia fuera del equipo; contraseña de `pos` probablemente en `%PGPASSWORD%` o `pgpass` sin control. Es data financiera.
Recomendación: script `.ps1` versionado con timestamp ISO (`Get-Date -Format yyyyMMdd-HHmmss`), `pg_dump -Fc` + verificación (`pg_restore --list`), retención (borrar >N días), copia a segundo disco/NAS, y un simulacro de restore trimestral documentado. Considerar `pgBackRest`/WAL archiving si el RPO importa.

---

## Medio

### M1 — `scripts/sqlite-to-postgres.ts`
- Líneas ~150-172: cada tabla se copia en su **propia** transacción (`BEGIN/COMMIT` por tabla). Un fallo a mitad (p.ej. en `sales`) deja `users/categories/products/customers/cash_sessions` ya commiteados → BD destino inconsistente y el script aborta (`process.exit(1)`).
- No hace `pg_dump` del destino antes de tocarlo; el "rollback" documentado (`docs/fase-2-migracion.md:145-147`) es `DROP DATABASE`.
- `--truncate` hace `TRUNCATE ... RESTART IDENTITY CASCADE` (destructivo, propaga a tablas no listadas).
- La verificación de integridad (conteos fila a fila) es 100% manual (`fase-2-migracion.md:66-68`).
Recomendación: envolver toda la copia + `setval` en una única transacción; exigir/automatizar un dump del destino antes; añadir un modo `--verify` que compare `count(*)` por tabla y aborte si difieren.

### M2 — `electron-builder.yml` denylist en `files`
Líneas 9-19: se usa lista de exclusión con patrones como `!src/*` (sólo hijos directos de `src/`, **no** `src/main/**`, `src/renderer/**`). electron-builder incluye por defecto todo lo no excluido → el asar acaba con el código fuente TS/TSX completo, `resources/` (ya en `asarUnpack`), y posible basura de dev. `main` apunta a `out/main/index.js`, así que `src/` no se necesita.
Recomendación: cambiar a allowlist explícita (`files: ['out/**', 'package.json', 'node_modules/**']` + lo mínimo). Verificar con `pnpm exec electron-builder --dir` y revisar el contenido del `app.asar`.

### M3 — Observabilidad de pm2
`deploy/ecosystem.config.cjs`: `autorestart`, `max_restarts: 10`, `max_memory_restart: '400M'`, pero:
- Sin `pm2-logrotate` (el runbook no lo instala) → los logs de pm2 crecen sin límite en `C:\Users\...\.pm2\logs`.
- `src/main/server.ts:55`: logger Fastify en `warn` en producción → prácticamente sin log de requests, sin trazabilidad de operaciones (útil para un POS: quién hizo qué venta/anulación).
- Tras 10 reinicios pm2 marca la app `errored` y **no avisa a nadie** (no hay healthcheck externo ni alerta).
- `/api/ping` (`src/main/routes/ping.ts`) reporta estado de BD pero nada lo consume.
Recomendación: `pm2 install pm2-logrotate` en el runbook (con `max_size`, `retain`, `compress`); subir el log de Fastify a `info` con `redact` de credenciales, o añadir un log de auditoría de negocio; un monitor externo (aunque sea una tarea programada que hace `curl /api/ping` y alerta por email/Telegram si falla).

### M4 — Sin TLS tabletas ↔ servidor
`docs/fase-2-migracion.md:13-21` y `:153`: todo el tráfico es `http://192.168.1.10:3000/`. El login manda usuario/contraseña y luego el JWT (`src/main/lib/jwt.ts`) viaja en `Authorization` en claro. En una LAN con WiFi (tabletas) esto es capturable por ARP spoofing / AP rogue / cliente comprometido.
Recomendación: TLS con certificado interno (mkcert / CA propia importada en las tabletas) y `https` en Fastify, o un reverse proxy (Caddy) que termine TLS; documentar como riesgo aceptado si el cliente rechaza la complejidad.

### M5 — Sourcemap en producción
`tsup.config.ts:18` `sourcemap: true` → `scripts/build-server.ts` no lo excluye → `dist-server/server.cjs.map` (209 KB) se copia al servidor. Expone el código fuente completo del backend en la PC del cliente.
Recomendación: `sourcemap: false` para el bundle de despliegue (o generar sourcemaps sólo para un artefacto de debugging que no se copia), o borrar `*.map` en `build-server.ts` antes de empaquetar.

### M6 — `electron-store` en el servidor
`src/main/lib/store.ts:31` `ENCRYPTION_KEY = 'SPARTAN_TECH_2026_SECRET'` (constante en el binario; el propio comentario admite que no es un secreto real). `:38` `clearInvalidConfig: true`: si `pos-config.json` se corrompe (corte de luz en la PC servidor, escritura a medias), electron-store lo **borra silenciosamente** → se pierde `jwt_secret` (todas las sesiones se invalidan) y `license_key`/`license_fingerprint` → el servidor arranca pidiendo **reactivar licencia**, lo que requiere al proveedor. Downtime del negocio.
Recomendación: para el servidor, persistir `jwt_secret` en una variable de entorno/`.env` (no autogenerado) y la licencia en la tabla `license` de PostgreSQL como fuente de verdad; o al menos `clearInvalidConfig: false` + backup del `pos-config.json`.

### M7 — Runbook Fase 2 frágil / no probado
`docs/fase-2-instalacion-windows.md`: estado real = *"Día 1 y Día 2 completos… Día 3 en adelante, pendiente"*. Nunca se ha probado end-to-end el servidor + pm2 + red + multicajero.
Fragilidades concretas: transferencia por drag&drop de todo el proyecto (`:54-58`); instalación manual de Python + VS Build Tools con gotcha del workload C++ (`:28-38`); `corepack enable` requiere PowerShell admin (`:76-84`); `Set-ExecutionPolicy` (`:92-96`); `db:generate:pg` en la máquina destino (`:114-122`) en vez de traer migraciones fijas; sin instalador atendido. El orden Día 1→5 mezcla dev y prod en la misma máquina.
Recomendación: convertir Días 3-5 en un script `.ps1` idempotente (instala Node vía winget, configura firewall, copia `dist-server`, `npm ci --omit=dev`, registra el servicio) y probarlo entero en la VM antes de la PC del cliente. Traer `resources/migrations-pg` ya generado (no `db:generate:pg` en destino).

### M8 — `electron-store` ESM-only desde bundle CJS
`package.json:45` `electron-store@^11` es ESM puro. `tsup` genera `server.cjs` que hace `require('electron-store')` (externalizado). `require()` de ESM sólo funciona sin flag en Node ≥20.19 / ≥22. El runbook (`fase-2-migracion.md:102`) dice "Node 20.19+ o 22" pero `package.json:11` permite `>=20` y `fase-2-instalacion-windows.md` instala "Node 22". Si alguien usa Node 20.0-20.18 en el servidor → el servidor no arranca.
Recomendación: `"node": ">=22"` en `engines`, `.nvmrc` con `22`, y validación de versión al inicio de `src/server/index.ts`.

---

## Bajo

- **B1** `tsup.config.ts:8` y `scripts/build-server.ts` mencionan `scripts/build-server.mjs`; el archivo es `.ts`. Drift de documentación.
- **B2** `src/main/services/license.ts` / `electron.vite.config.ts:11-13`: `POS_VENDOR_SECRET` queda en claro dentro de `out/main/index.js` (asar) — extraíble con `npx asar extract`. Es inherente al esquema de licencia offline y está documentado, pero para Fase 2 (hay servidor) conviene mover la validación de licencia al servidor y no exponer el secreto en cada cliente.
- **B3** `src/server/config.ts:9-21`: parser `.env` casero — no soporta valores multilínea, `#` dentro de un valor lo trunca, comillas sólo al borde. Suficiente hoy; usar `--env-file` de Node 22 o `dotenv` si crece.
- **B4** `dist-server/` está en `.gitignore` (correcto) pero no hay checksum ni etiqueta de versión del bundle desplegado; `dist-server/package.json` toma la versión de `package.json` (`0.1.0`, nunca subida). Difícil saber qué build corre en el cliente. Añadir `git rev-parse HEAD` a un `BUILD_INFO` dentro del bundle.
- **B5** El servidor se despliega bare-metal (Windows + pm2). Un `Dockerfile` multi-stage (aunque el cliente use Windows nativo) daría un build reproducible verificable en CI y una ruta alternativa de despliegue.

---

## Notas sobre lo que SÍ está bien

- `electron-builder.yml`: `asarUnpack` de `**/*.node` y `resources/**` correcto para `better-sqlite3`; `npmRebuild: true`; NSIS no one-click con carpeta configurable; excluye `.env*`, `.npmrc`, lockfile del paquete.
- `tsup.config.ts`: `--packages=external` correcto para no bundlear nativos; `pg` es JS puro (ok); el `package.json` generado por `build-server.ts` filtra bien las deps Electron-only.
- `scripts/check-vendor-secret.ts`: buena idea (rechaza secretos cortos y `KNOWN_LEAKED_SECRETS`) — sólo hay que **commitearlo** y aplicarlo también a `build:server` (ver C1, C2).
- `src/main/routes/license.ts`: throttle por IP en la activación; comparación en tiempo constante (`safeEqual`).
- `.npmrc` (`node-linker=hoisted`) y `pnpm-workspace.yaml` (`allowBuilds`) documentados y justificados.
- `/api/ping` reporta motor + estado de BD + versión: buena base para un healthcheck (falta que algo lo use).
- `packageManager: pnpm@11.24.0` pinneado.
