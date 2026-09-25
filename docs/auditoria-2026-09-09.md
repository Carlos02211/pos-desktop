# Auditoría consolidada — POS SpArTaN Tech

**Fecha:** 2026-09-09 · **Rama:** `main` (árbol de trabajo sucio: 38 modificados + 13 sin seguir)
**Modo:** solo lectura. Sin cambios en el repo.
**Especialistas ejecutados en paralelo:** arquitectura · seguridad · base de datos · backend · frontend · devops
**Informes individuales:** `docs/auditoria-2026-09-09/{architect,security,database,backend,frontend,devops}.md`

---

## 0. Estado de remediación (actualizado 2026-09-09)

Las correcciones viven en la rama **`fase2/dinero-centavos`** (parte de
`fase2/hardening-auditoria`). No mergeadas a `main` todavía.

**Cerrado:** C1–C6 · Socket.io autenticado · TLS opcional · folio/caja únicos + índices en
todas las FK · locks de fila (venta/abono/cierre) · dinero → centavos · idempotencia de
venta · `sqlite-to-postgres` con verificación · JWT allowlist + issuer · `DUMMY_HASH` real ·
`PRAGMA foreign_keys` a nivel de conexión · CORS = mismo origen · cabeceras + **CSP completa
para la SPA** · electron-builder allowlist · sourcemap off · throttle de login · paridad de
esquemas automatizada (`pnpm check:schema`) · zona horaria configurable · uploads validados
por magic bytes · `JWT_SECRET` por entorno · `clearInvalidConfig:false` · filtro de historial
por CREDIT · CI (GitHub Actions) · movimientos de caja (retiros/ingresos) · impresora con
timeout · **tope de descuento máx. configurable** · `license` con índice único · Electron
`sandbox:true` + `will-navigate` · `openCreditAccount` eliminado · **focus-trap en modales** ·
**combobox de cliente accesible por teclado** · **renombrar clientes en el admin** ·
re-renders de `PanelVenta` (selectores + memo) · blob URL leak · **`deploy/backup-pg.ps1`** +
**`deploy/setup-server.ps1`** (idempotente).

**Parcial / aceptado:** exportación de reportes a PDF/Excel síncrona — bloquea el event loop
~1-2 s en un reporte mensual. Aceptado para negocios chicos (acción de admin poco frecuente,
dataset pequeño); el fix real es un worker thread. `@fastify/helmet` completo (hoy: CSP +
headers a mano, cubre lo esencial).

**Abierto:** 3 fuentes de verdad para tipos (interface/Zod/Drizzle) — refactor arquitectónico.

**Omitido por decisión (coste):** firma del `.exe`, auto-update.

**Antes de mergear:** rotar `POS_VENDOR_SECRET`; probar contra PostgreSQL real; correr
`migrate:sqlite-to-pg` con la BD real.

---

## 1. Veredicto

La base es sólida para la **Fase 1** (Electron, una máquina): validación Zod en todos los endpoints,
autorización server-side con `requireRole`, Drizzle parametrizado sin SQL crudo, JWT solo en memoria en
el renderer, error handler que no filtra stack traces, reutilización limpia del backend entre Electron y
el servidor standalone, dependencias sin CVEs relevantes.

**La Fase 2 (servidor standalone multicajero en `0.0.0.0:3000`) NO está lista para producción.** Varias
invariantes que hoy se sostienen solas gracias al driver síncrono de SQLite y al aislamiento en
`127.0.0.1` dejan de cumplirse con PostgreSQL, concurrencia real y exposición de red. Hay además un
bloqueante de build (archivos sin commitear) y un bloqueante de datos (el script de migración corrompe
datos en silencio).

**Recomendación:** no desplegar Fase 2 hasta cerrar los 6 puntos Críticos y, como mínimo, los Altos de
seguridad y concurrencia.

---

## 2. Críticos — bloquean la Fase 2

| # | Tema | Evidencia | Reportado por |
|---|------|-----------|---------------|
| **C1** | **Credenciales por defecto `admin/admin123` y `cajero/cajero123`** (están en el repo) sembradas en cada arranque, sin cambio forzado, en un servidor accesible por toda la LAN. Login sin rate-limit ni lockout. → ADMIN completo para cualquier dispositivo de la red. | `src/main/db/seed.ts:31-45`, `src/server/index.ts:27`, `src/main/routes/auth.ts:14-17` | seguridad, backend, devops |
| **C2** | **`POS_VENDOR_SECRET` comprometido.** Valor real (`SPARTAN-TECH-VENDOR-SECRET-2026`) commiteado en git (commit `62e0cc0`, `deploy/.env.example`). El servidor standalone **no aborta** si falta o es un valor conocido: solo `console.warn` y cae a `DEV_ONLY_SECRET` (público). `check-vendor-secret.ts` solo protege `build:win`, no `build:server` ni `src/server/index.ts`. `.env.example` afirma "sin el valor el servidor no arranca" — es falso. → Falsificación / bypass de licencias. `GET /api/licencia/estado` y `POST /api/licencia/activar` son anónimos y el primero filtra el hardware fingerprint. | `src/main/services/license.ts:28-47`, `src/server/index.ts`, `deploy/.env.example:21-24`, `src/main/routes/license.ts:35-61` | seguridad, devops, arquitectura, backend |
| **C3** | **`scripts/sqlite-to-postgres.ts` corrompe datos en silencio.** Las listas de columnas hardcodeadas están desactualizadas: faltan `products.unit`, `sale_items.unit`, `sale_items.original_price`, `sales.customer_id`. El INSERT usa lista explícita → las columnas ausentes toman default/NULL **sin error**. La migración "termina con ✅" pero deja productos por KG como PIEZA, pierde el rastro de descuentos y el vínculo cliente↔venta. | `scripts/sqlite-to-postgres.ts:37,64,78` | base de datos |
| **C4** | **Archivos imprescindibles sin commitear.** `scripts/check-vendor-secret.ts` (lo invoca `build:win`) y 6 migraciones SQL nuevas (`resources/migrations/0002-0004`, `resources/migrations-pg/0001-0003` + snapshots) están sin seguir; los `_journal.json` están modificados pero los SQL no. → Un clon limpio **no compila** y aplica un esquema de BD incompleto; el código ya asume `products.unit`, `sale_items.unit/original_price`, `sales.customer_id`. | `git status`, `src/main/db/index.ts:96-108` | devops, base de datos, arquitectura |
| **C5** | **`withTx()` sobre SQLite no es seguro bajo concurrencia.** El comentario ("driver síncrono, no hay hueco de asincronía") es falso: `createSale` hace múltiples `await` dentro del callback y cada `await` cede el event loop. Una segunda petición concurrente emite `BEGIN` dentro de la transacción ajena → `cannot start a transaction within a transaction` o sentencias que hacen commit/rollback con la transacción de otro request. Fallo seguro de corrupción si el standalone corre con SQLite (fallback soportado, `HOST=0.0.0.0`). | `src/main/db/tx.ts:8-32`, `src/main/services/ventas.ts:53-170` | arquitectura, backend, seguridad |
| **C6** | **El renderer es autoritativo sobre el precio de cada línea.** `CobroModal` envía **siempre** `price` por ítem y el servidor lo acepta incondicionalmente (`line.price != null`). Rompe el invariante "el precio lo pone el servidor". Un renderer modificado fija cualquier precio en `0 < p ≤ 1.000.000`. Además: si el admin cambia un precio de catálogo mientras el ítem ya está en el carrito, el cliente manda el precio viejo y el backend marca la venta como "precio editado" en falso, cobrando el importe equivocado. | `src/renderer/src/components/CobroModal.tsx:105`, `src/main/services/ventas.ts:76-82` | frontend, seguridad, backend |

---

## 3. Altos

### Seguridad / red (Fase 2)
- **Socket.io sin autenticación.** `io.on('connection')` no valida nada (`// En Fase 2 aquí se autenticará` — pendiente). `emit()` es global. Cualquier dispositivo de la LAN recibe `venta:nueva` (totales), `caja:cierre` (diferencias de efectivo), `cuenta:abono` (saldos y `customerId`). — `src/main/socket.ts:16-23`
- **Sin TLS.** API y login en HTTP plano por LAN/WiFi. `password` y `Authorization: Bearer <JWT 8h>` viajan sin cifrar → sniffing / ARP spoofing. — `src/main/server.ts:120-129`, `deploy/.env.example:6-7`
- **Instalador NSIS sin firma de código** (`electron-builder.yml` sin `signtoolOptions`) → SmartScreen bloquea; un `.exe` manipulado en tránsito (se distribuye por USB/drag&drop) es indetectable.
- **Sin auto-update** (`publish: null`, sin electron-updater) → cada parche de un POS que maneja dinero exige reinstalación manual en cada equipo, sin rollback ni control de versión.
- **Sin CI/CD** (no existe `.github/`) → builds manuales no reproducibles, `better-sqlite3` recompilado en destino (riesgo ABI), Node sin pin (`.nvmrc` ausente), `verify:backend` (~145 checks) nunca corre como gate.

### Concurrencia / integridad de datos (PostgreSQL multicajero)
- **`ticketNumber` con condición de carrera.** `max(ticket_number)+1` sin `UNIQUE(cash_session_id, ticket_number)` ni `SELECT ... FOR UPDATE` (no hay ningún `FOR UPDATE` en el repo) → folios duplicados con ventas concurrentes. — `src/main/services/ventas.ts:118-136`
- **Abonos concurrentes desincronizan `credit_accounts.paid`.** `addAbono` lee `paid`, inserta el pago y hace `set paid = paid_leído + amount` (last-write-wins). Dos abonos simultáneos: ambos insertan en `credit_payments`, el `UPDATE` refleja uno → saldo erróneo, cuenta que no se liquida nunca, y la validación `amount <= balance` usa saldo obsoleto (sobrepago posible). — `src/main/services/cuentas.ts:137-171`
- **`openSession` con carrera** → varias cajas OPEN por usuario; las ventas se reparten, un cierre cierra una y la otra queda abierta, cuadre incorrecto. Falta índice único parcial `(user_id) WHERE status='OPEN'`. — `src/main/services/caja.ts:23-39`
- **Cero índices secundarios** en todo el esquema (ambos motores). PG no indexa las FK automáticamente. `sales.created_at` (todos los reportes), `sale_items.sale_id` (subconsultas N+1), `sales.cash_session_id`, y todas las FK → *seq scans*. Tolerable en SQLite single-node; degrada de forma no lineal en PG con historial.

### Negocio / arquitectura
- **Precio de línea editable por el cajero sin tope ni autorización.** Cualquier `price > 0` hasta 1.000.000, sin comparar contra `product.price`, sin PIN/rol de ADMIN. En CASH está acotado por `amountPaid >= total`, pero en CARD/TRANSFER/CREDIT permite sub-registrar ventas (fraude). Rastro solo parcial en `sale_items.original_price`. — `src/main/services/ventas.ts:76-82`, `src/main/routes/ventas.ts:29`
- **Dinero como coma flotante** (`double precision` en PG, `real` en SQLite). Los `round2/round3` mitigan, pero los `SUM()` se hacen en SQL **antes** del redondeo en JS; comparaciones de igualdad frágiles (`paid >= total`). Anti-patrón en PG; el cambio a "precio editable" + "cantidades KG" multiplica las operaciones float. Momento ideal para migrar a centavos enteros / `NUMERIC(12,2)` ya que se está tocando el esquema. — `schema.pg.ts`, `schema.sqlite.ts`, `src/main/lib/money.ts`
- **Impresión y PDF/Excel en el hilo del request.** `await printTicket(...)` **antes** de responder 201, `ThermalPrinter` sin `timeout` explícito → una impresora TCP inaccesible suma segundos a cada venta y bloquea el event loop para todos los cajeros. `generateReportPdf` es síncrona. — `src/main/routes/ventas.ts:63`, `src/main/services/printer.ts:63-70`, `src/main/services/reports-pdf.ts:34`
- **Sin idempotencia en `POST /api/ventas`.** Un timeout de red o doble submit genera una segunda venta con su propio folio, doble impresión y (en CREDIT) segunda cuenta por cobrar. El `CobroModal` además se cierra con Escape/overlay durante el submit, agravándolo. — `src/renderer/src/components/CobroModal.tsx:98-118`, `src/main/routes/ventas.ts:41`
- **Dos esquemas Drizzle mantenidos a mano, sin test de paridad.** `schema.ts:17` hace `as unknown as typeof pgSchema` y `DB` se tipa solo como Postgres: una query válida en un solo motor compila y revienta en runtime en el otro. La paridad hoy depende de la disciplina del autor. — `src/main/db/schema.ts`, `src/main/db/index.ts`
- **Migraciones nuevas sin commitear** (ver C4) → riesgo de despliegue con esquema viejo y runtime que falla al leer/insertar columnas nuevas.
- **Backups de PostgreSQL.** Única mención: un `pg_dump ... > pos_%DATE%.dump` en el Programador de tareas. `%DATE%` depende del locale de Windows (nombres inválidos), sin rotación, retención, verificación ni prueba de restore. Data financiera. La app no verifica que exista un backup. — `docs/fase-2-migracion.md:167-172`

---

## 4. Medios

| Área | Hallazgo | Ref |
|------|----------|-----|
| Red | CORS `origin:true` + `credentials:true` por defecto en el standalone (combinación inválida por spec). Exige `POS_ALLOWED_ORIGINS` explícito. | `src/main/server.ts:67-70`, `src/server/config.ts:50-52` |
| Red | Sin cabeceras de seguridad (no hay `@fastify/helmet`) ni CSP efectiva para la SPA servida por HTTP en Fase 2. CSP del renderer con `unsafe-inline`/`unsafe-eval`. | `src/main/server.ts`, `src/renderer/index.html:10-18` |
| Auth | `jwt_secret` (aleatorio por instalación, bien) cifrado en disco con clave **estática embebida** en el código (`'SPARTAN_TECH_2026_SECRET'`). Quien lea `pos-config.json` forja tokens ADMIN. | `src/main/lib/store.ts:29` |
| Auth | `jwt.verify` sin `{ algorithms: ['HS256'] }`, sin `issuer/audience`, token de 8 h sin revocación (`logout` es no-op). | `src/main/lib/jwt.ts:14-21` |
| Auth | `DUMMY_HASH` de login mal formado → o rompe la mitigación anti-timing (enumeración de usuarios) o lanza 500 en login de usuario inexistente. | `src/main/services/auth.ts:11` |
| Uploads | Se decide la extensión con el `Content-Type` del cliente; sin validación de magic bytes. `/uploads/` servido en el mismo origen que la SPA en Fase 2. | `src/main/routes/productos.ts:74-86`, `config.ts:39-51` |
| Licencia | `GET /api/licencia/estado` (anónimo) revela el fingerprint; `POST /api/licencia/activar` (anónimo) muta la tabla `license`. | `src/main/routes/license.ts:35-61` |
| Caja | `closeSession` no atómico respecto a ventas en vuelo → efectivo esperado / diferencia mal calculados. | `src/main/services/caja.ts:122-148` |
| Caja | El cuadre no contempla retiros / ingresos de efectivo: si el negocio saca dinero en el turno, el cierre siempre marca faltante. | `src/main/services/caja.ts:88-90` |
| Reportes | Zona horaria implícita (TZ del proceso). Un servicio pm2/Windows en UTC desplaza "hoy", los cortes diarios y los buckets horarios. | `src/main/services/dashboard.ts:9-14`, `reportes.ts:21-46` |
| Reportes | `buildReport` carga todas las ventas del período en memoria; sin índice en `created_at` además hace seq scan. | `src/main/services/reportes.ts:101` |
| DB | Sin `CHECK` constraints en columnas tipo-enum (`role`, `status` x3, `payment_method` x2, `unit` x2, `active`). Drizzle solo valida en TS. | `schema.*.ts` |
| DB | `sale_items` insertado en bucle (N+1 de escritura) → alarga la ventana de bloqueo en PG. Igual patrón de lectura N+1 en `getCreditAccountDetail`. | `src/main/services/ventas.ts:139-145` |
| DB | `sqlite-to-postgres.ts`: una transacción **por tabla** → un fallo a mitad deja la BD destino inconsistente; sin `pg_dump` previo. | `scripts/sqlite-to-postgres.ts` |
| DB | `PRAGMA foreign_keys=OFF` es no-op dentro de la transacción del migrador (SQLite 0003); funciona solo por ser `sale_items` tabla hoja. Frágil. | `resources/migrations/0003_*.sql:1` |
| Build | `electron-builder.yml` usa denylist (`!src/*` no cubre `src/main/**`) → el `app.asar` acaba con el código fuente TS/TSX completo. Cambiar a allowlist. | `electron-builder.yml:9-19` |
| Build | `tsup` con `sourcemap: true` → `server.cjs.map` (código fuente del backend) se despliega a producción. | `tsup.config.ts:18` |
| Ops | pm2 sin `pm2-logrotate` (logs sin límite), logger Fastify en `warn` (sin trazabilidad de operaciones), sin alerta tras `max_restarts`, `/api/ping` no lo consume nadie. | `deploy/ecosystem.config.cjs`, `src/main/server.ts:55` |
| Ops | `electron-store` con `clearInvalidConfig: true` → si `pos-config.json` se corrompe (corte de luz), borra `jwt_secret` (invalida sesiones) y la licencia (arranca pidiendo reactivación → depende del proveedor). | `src/main/lib/store.ts:38` |
| Ops | `electron-store@11` es ESM puro; `require()` desde el bundle CJS solo funciona en Node ≥20.19/22, pero `engines` permite `>=20`. | `package.json:11` |
| Runbook | `docs/fase-2-instalacion-windows.md`: "Día 3 en adelante, pendiente". Nunca probado end-to-end. Transferencia por drag&drop, Python + VS Build Tools manual, `Set-ExecutionPolicy`, `db:generate:pg` en la máquina destino. | `docs/fase-2-instalacion-windows.md` |
| Contrato | `SalesQuery.paymentMethod` (tipo compartido) incluye `CREDIT`, pero el schema Zod de la ruta es `['CASH','CARD','TRANSFER']` → el admin no puede listar ventas fiadas (400). | `src/shared/types.ts:279` vs `src/main/routes/ventas.ts:18` |
| Frontend | Creación duplicada de cliente al reintentar un fiado (`ensureCustomer` no refresca `customers` tras `crearCliente`). | `src/renderer/src/components/CobroModal.tsx:82-96` |
| Frontend | `PanelVenta` sin selector de store → cada mutación del carrito re-renderiza la grilla entera de productos (`ProductoBtn` sin `memo`, lista no virtualizada). | `src/renderer/src/pages/cobrador/PanelVenta.tsx:25` |
| Frontend | `ProductoFormModal`: `URL.createObjectURL` en cada render sin `revokeObjectURL` (fuga de blob URLs). | `src/renderer/src/components/admin/ProductoFormModal.tsx:32-36` |
| Frontend | Pantalla del cobrador sin indicador de conexión ni re-sync del catálogo al reconectar el socket (relevante en Fase 2). | `PanelVenta.tsx`, `SessionBar.tsx` |
| A11y | Modales sin `role="dialog"`/`aria-modal`/focus trap; autocompletar de cliente solo con `onMouseDown`, no navegable por teclado (POS operado con teclado). | `src/renderer/src/components/Modal.tsx`, `CobroModal.tsx:146-196` |
| KG | Un toque en producto KG suma +1 kg sin señal visual; el input de gramos acepta no-enteros (`"1.5"` g → 0.002 kg) y no normaliza coma decimal. | `src/renderer/src/stores/cart.store.ts:27-50`, `CarritoItem.tsx:51-58` |
| Infra | `printer_interface` (editable por ADMIN) pasa sin filtrar a `node-thermal-printer`; acepta `tcp://host:port` → SSRF / escaneo de red interna desde el servidor. | `src/main/services/printer.ts:57-70` |
| Detección de dialecto | Duplicada en 4 sitios con lógica propia cada uno. | `db/index.ts`, `db/schema.ts`, `server/config.ts`, `verify-backend.ts` |

---

## 5. Bajos (selección)

- `round2` con `+ Number.EPSILON`: insuficiente para valores > 1 y sesgo equivocado en negativos. Ligado al tema de dinero float.
- Formato de dinero/cantidad del cliente (`lib/format.ts`) diverge del ticket impreso (`printer.ts`): `$` hardcodeado, ceros recortados vs `toFixed(3)`, `${quantity}x` en el papel para KG. Falta una utilidad de formato compartida en `src/shared`.
- Código muerto / regresión de producto: `openCreditAccount` no se usa (`createSale` inserta la cuenta inline); tras borrar `ClienteFormModal` **ya no hay forma en la UI de renombrar ni desactivar clientes**, pero `PUT/DELETE /api/clientes/:id` + `updateCustomer/deactivateCustomer` + su test en `verify-backend.ts` siguen vivos.
- `license` sin constraint de unicidad (varias filas `ACTIVE` posibles).
- Throttle de licencia: `Map` en memoria sin purga (fuga lenta acotada por IPs de la LAN); sin `trustProxy`.
- `bcryptjs` trunca a 72 bytes en silencio (el schema permite 200 caracteres).
- `sandbox: false` en Electron; sin handler `will-navigate`.
- `deactivateCategory` no reasigna ni avisa de los productos que quedan apuntando a una categoría inactiva.
- Producto con `price = 0` (permitido por el schema) se puede vender gratis.
- Abonos y `POST /api/cuentas/:id/abono` responden 201 para lo que es una actualización (debería ser 200).
- `esbuild@0.18.20` (transitiva de dev, GHSA-67mh-4wv8-2f99) — impacto bajo, solo build/dev. Correr `pnpm audit` en CI.
- `_journal.json` sin newline final en ambas carpetas.

---

## 6. Lo que está bien (no tocar)

- Validación Zod en **todos** los endpoints; `HttpError` con códigos correctos; error handler que devuelve mensaje genérico en 500 y no filtra stack ni SQL ni entorno.
- Autorización server-side con `requireRole` en cada ruta; el bypass de ADMIN es intencional.
- Drizzle parametrizado en todo; sin SQL construido con input de usuario. Sin SSRF de URLs de usuario, sin path traversal (nombres `randomUUID`).
- Renderer: token JWT **solo en memoria** (sin `localStorage`/`sessionStorage` en todo el renderer), sin `dangerouslySetInnerHTML` ni `eval`. El servidor recalcula todos los totales.
- Reutilización real del backend entre Electron y el servidor standalone (`src/server` reusa `startServer` + todos los `services/` sin fork). Frontera Renderer↔HTTP limpia. `shared/types.ts` como contrato único (con las 2 salvedades de §4).
- Endurecimiento de licencia: `KNOWN_LEAKED_SECRETS`, `crypto.timingSafeEqual`, throttle por IP en la activación, `check-vendor-secret.ts` que corta el build (solo falta commitearlo y extenderlo a `build:server` / `src/server/index.ts`).
- Electron: `contextIsolation` on, `nodeIntegration` off, `setWindowOpenHandler` (deny + openExternal), preload mínimo.
- Login con hash dummy anti-enumeración por temporización (la idea es correcta; el hash concreto está mal — §4).
- Socket.io como "solo notificación, el cliente hace fetch": patrón correcto y bien documentado.
- Paridad `schema.sqlite.ts` ↔ `schema.pg.ts`: **correcta en el estado actual** (mapeos consistentes de tipos, timestamps epoch UTC, booleanos 0/1, enums text, identidad autoincremental). El riesgo es de proceso (se sincronizan a mano), no de código.
- `withTx` en PG delega en la transacción nativa de Drizzle (correcto); el reajuste de secuencias (`setval` / `OVERRIDING SYSTEM VALUE`) en el migrador es correcto.
- Dependencias sin CVEs relevantes: `fastify@5.12.3`, `jsonwebtoken@9.0.3`, `socket.io@4.8.3`, `systeminformation@5.33.8` (post-parche CVE-2024-56334), `electron@39.8.10`.
- `asarUnpack` de nativos correcto; `npmRebuild`; `--packages=external` en tsup; `packageManager` pinneado.

---

## 7. Plan de remediación sugerido

### Antes de commitear el diff actual
1. Crear rama. Añadir a git las 6 migraciones + snapshots + `check-vendor-secret.ts`. Commitear Fase 2 en bloques coherentes (esquema+migraciones / servicios / renderer). **(C4)**
2. Añadir un test de paridad de esquemas SQLite↔PG a `verify:backend` y hacerlo correr. **(C4, arquitectura A1)**
3. Corregir `scripts/sqlite-to-postgres.ts`: derivar las columnas del esquema Drizzle / `information_schema`, no hardcodearlas; añadir verificación post-migración (conteos + sumas de control). **(C3)**
4. `CobroModal`: enviar `price` solo cuando `i.price !== i.originalPrice`. En el backend, validar el precio editado contra el de catálogo. **(C6, Alto negocio)**

### Antes de exponer la Fase 2 a la red
5. Forzar cambio de contraseña de `admin` en el primer login (flag `must_change_password`); no sembrar `cajero` de prueba en producción. **(C1)**
6. `@fastify/rate-limit` en `/api/auth/login`. **(C1)**
7. `io.use()` que verifique el JWT del handshake; salas por rol. Pasar el token desde el renderer. **(Alto Socket.io)**
8. TLS: reverse proxy local (Caddy/mkcert) o `https` nativo. Documentar en el runbook. **(Alto TLS)**
9. Rotar `POS_VENDOR_SECRET`; hacer que `src/server/index.ts` aborte si falta / es un valor conocido / `=== DEV_ONLY_SECRET` en prod; añadir `check-vendor-secret.ts` a `build:server`. Autenticar `/api/licencia/activar` y no exponer el fingerprint sin auth. **(C2)**
10. Exigir `POS_ALLOWED_ORIGINS` explícito; `@fastify/helmet` con CSP para la SPA. **(Medio CORS/headers)**
11. Decidir explícitamente: **Fase 2 = PostgreSQL siempre** → forzar `DATABASE_URL` presente en el arranque del standalone y documentar SQLite como mono-cliente. Si no, serializar toda la ruta de escritura SQLite con un mutex. **(C5)**

### Migración de esquema (aprovechar que ya se toca)
12. Nueva migración (ambos motores) con: índices en FK + `sales.created_at` + columnas de filtro; `UNIQUE(cash_session_id, ticket_number)`; índice único parcial `cash_sessions(user_id) WHERE status='OPEN'`; `CHECK` en columnas enum. **(Alto índices + carreras)**
13. `SELECT ... FOR UPDATE` (o `UPDATE ... paid = paid + ? RETURNING`) en `addAbono`; mover `getActiveSession` dentro de la transacción en `createSale`/`addAbono`/`openSession`. **(Alto abonos, openSession)**
14. Plan: migrar dinero a centavos enteros / `NUMERIC(12,2)`; mover todos los `round2` al borde de entrada. **(Alto dinero float)**

### Infra / operación
15. Impresión y PDF fuera del hilo del request (background + notificación por socket); `timeout` explícito de 3-5 s en `ThermalPrinter`. **(Alto impresión)**
16. Token de idempotencia (UUID de cliente) en `POST /api/ventas` + índice único; bloquear cierre del `Modal` durante el submit. **(Alto idempotencia)**
17. Firma de código del instalador; definir estrategia de auto-update. **(Alto firma / update)**
18. GitHub Actions: `typecheck` + `lint` + `verify:backend:pg` como gate; build Windows firmado; Node pinneado (`.nvmrc`), `--frozen-lockfile`. **(Alto CI/CD)**
19. Script `.ps1` idempotente para los Días 3-5 del runbook; traer `resources/migrations-pg` ya generado. Backups PG: script versionado con timestamp ISO, `pg_restore --list` de verificación, retención, copia externa, simulacro de restore. **(Alto backups + Medio runbook)**

### Producto (decidir, no bloqueante)
20. ¿Reactivar edición/baja de clientes en la UI, o eliminar los endpoints huérfanos `PUT/DELETE /api/clientes/:id`?
21. Impresión de tickets: ¿por dispositivo (cada puesto su impresora) o desde el cliente? El diseño actual (`config.printer_interface` global) no sirve para multicajero.
22. Política de descuento: tope %, o autorización de ADMIN por PIN, + reporte de líneas con precio editado.
