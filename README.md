# POS SpArTaN Tech

Sistema de Punto de Venta para Windows 10/11 (React + Fastify + Drizzle).

- **Fase 1** — app de escritorio Electron con SQLite embebido.
- **Fase 2** — el mismo servidor y la misma lógica de negocio, fuera de Electron,
  contra PostgreSQL, sirviendo la SPA a varias tabletas en la red local. El swap
  lo decide `DATABASE_URL`; no se reescribe nada de negocio.

## Estado

### Sprint 0 — Scaffold ✅

| Entregable                                             | Estado |
| ------------------------------------------------------ | ------ |
| Scaffold electron-vite (React + TypeScript)            | ✅     |
| Tailwind CSS v4 + tokens de marca + base shadcn/ui     | ✅     |
| Drizzle ORM + better-sqlite3 + `schema.ts` (8 tablas)  | ✅     |
| Primera migración (`resources/migrations/0000_*.sql`)  | ✅     |
| Servidor Fastify en el Main Process (`localhost:3001`) | ✅     |
| Socket.io montado sobre el mismo servidor HTTP         | ✅     |
| Endpoint `/api/ping` (Renderer → Fastify → SQLite)     | ✅     |
| `electron-builder.yml` (NSIS x64, español)             | ✅     |

### Sprint 1 — Licencia + Autenticación ✅

| Entregable                                                           | Estado |
| -------------------------------------------------------------------- | ------ |
| Fingerprint SHA-256 del hardware (`systeminformation`)               | ✅     |
| Licencia offline firmada (Ed25519), store cifrado (`electron-store`) | ✅     |
| Pantalla de activación `/activation` (muestra el ID del equipo)      | ✅     |
| `GET /api/licencia/estado` · `POST /api/licencia/activar`            | ✅     |
| Login bcrypt + JWT (8 h), secreto por instalación                    | ✅     |
| `POST /api/auth/login` · `/logout` · `GET /api/auth/me`              | ✅     |
| `requireAuth` / `requireRole` (ADMIN pasa siempre)                   | ✅     |
| Pantalla `/login`, `auth.store` (token en memoria)                   | ✅     |
| `ProtectedRoute` + guards de rol (`/cobrador`, `/admin`)             | ✅     |
| Seed: `admin / admin123` (ADMIN) · `cajero / cajero123` (COBRADOR)   | ✅     |
| Generador de claves `pnpm license:gen`                               | ✅     |

### Sprint 2 — Panel del Cobrador ✅

| Entregable                                                               | Estado |
| ------------------------------------------------------------------------ | ------ |
| `GET /api/productos` (con categoría) · `GET /api/categorias`             | ✅     |
| `GET /api/caja/sesion-activa` · `POST /api/caja/apertura`                | ✅     |
| `POST /api/ventas` — transacción, snapshot de precio, folio, cambio      | ✅     |
| Emite `venta:nueva` y `caja:apertura` por Socket.io                      | ✅     |
| Grid de productos (botón grande + fallback), tabs de categoría, búsqueda | ✅     |
| Carrito (`cart.store`): agregar, ± cantidad, quitar, vaciar, total       | ✅     |
| Modal de cobro: método, monto recibido, cambio en vivo                   | ✅     |
| Gate "sin caja abierta" → pantalla de apertura                           | ✅     |
| Toasts (`sonner`) en apertura y venta; imágenes servidas en `/uploads/`  | ✅     |

### Sprint 3 — Caja + Impresora térmica ✅

| Entregable                                                            | Estado |
| --------------------------------------------------------------------- | ------ |
| `POST /api/caja/cierre` — efectivo esperado, diferencia, respaldo     | ✅     |
| `GET /api/caja/resumen` — totales del turno por método de pago        | ✅     |
| `services/printer.ts` — ticket ESC/POS (Epson), interfaz configurable | ✅     |
| Impresión best-effort: si falla, la venta se registra igual (aviso)   | ✅     |
| `POST /api/ventas/:id/reimprimir` (ADMIN)                             | ✅     |
| `services/backup.ts` — copia `pos.db` al cerrar caja, retiene 30      | ✅     |
| Pantalla `CajaCierre` con diferencia en vivo (verde/rojo)             | ✅     |
| Emite `caja:cierre` por Socket.io                                     | ✅     |

### Sprint 4 — Panel Admin: Productos y Categorías ✅

| Entregable                                                                    | Estado |
| ----------------------------------------------------------------------------- | ------ |
| CRUD categorías: `POST` / `PUT` / `DELETE /api/categorias` (ADMIN)            | ✅     |
| CRUD productos: `POST` / `PUT` / `DELETE /api/productos` (ADMIN)              | ✅     |
| `POST /api/productos/:id/imagen` — multipart, guarda en `/uploads/productos/` | ✅     |
| `?all=1` para que el ADMIN vea también inactivos                              | ✅     |
| Soft delete (nunca borra); baja de categoría = desactivación                  | ✅     |
| `AdminLayout` con sidebar + tablas de Productos y Categorías                  | ✅     |
| Modales de alta/edición con preview de imagen                                 | ✅     |
| Emite `producto:update` → el cobrador recarga el grid sin refrescar           | ✅     |

### Sprint 5 — Panel Admin: Usuarios, Ventas y Cortes ✅

| Entregable                                                           | Estado |
| -------------------------------------------------------------------- | ------ |
| CRUD usuarios: `GET`/`POST`/`PUT`/`DELETE /api/usuarios` (ADMIN)     | ✅     |
| Contraseña en texto plano desde el form → bcrypt en el backend       | ✅     |
| El ADMIN no puede desactivarse/borrarse ni cambiarse el rol          | ✅     |
| `GET /api/ventas` — paginado (50) + filtros fecha/cobrador/método    | ✅     |
| `GET /api/ventas/:id` — detalle con líneas + reimpresión             | ✅     |
| `GET /api/caja/historial` — cortes con nombre del cobrador y filtros | ✅     |
| Pantallas `Usuarios`, `Ventas` (modal de detalle), `Cortes`          | ✅     |
| Diferencia de caja en verde (sobrante) / rojo (faltante)             | ✅     |

### Sprint 6 — Reportes y Exportaciones ✅

| Entregable                                                             | Estado |
| ---------------------------------------------------------------------- | ------ |
| `GET /api/reportes/{diario,semanal,mensual}` (ADMIN)                   | ✅     |
| Total, desglose por método, top 5 productos, tramos por hora/día       | ✅     |
| `GET /api/reportes/exportar/excel` — ExcelJS (resumen + detalle)       | ✅     |
| `GET /api/reportes/exportar/pdf` — jsPDF + autotable (membrete + logo) | ✅     |
| Pantalla `Reportes`: tabs, selector, gráfica de barras (recharts)      | ✅     |
| Descarga con diálogo "Guardar como" (`will-download` en el Main)       | ✅     |
| Páginas admin cargadas con `React.lazy` (recharts en chunk aparte)     | ✅     |

### Sprint 7 — Configuración del Negocio + Dashboard ✅

| Entregable                                                                 | Estado |
| -------------------------------------------------------------------------- | ------ |
| `GET /api/config` · `PUT /api/config` (ADMIN)                              | ✅     |
| `POST /api/config/logo` — multipart, `/uploads/config/`                    | ✅     |
| El logo se usa en el membrete del PDF de reportes                          | ✅     |
| Pantalla `Configuración`: negocio, moneda, pie de ticket, logo, avanzado   | ✅     |
| `GET /api/dashboard` — ventas del día, desglose, cajas abiertas, últimas 5 | ✅     |
| `Dashboard` en vivo: `socket.store` refresca con `venta:nueva` / `caja:*`  | ✅     |

### Módulo extra — Cuentas por cobrar (fiado) ✅

Ventas que se pagan parcial o no se pagan quedan como **cuenta de crédito**
ligada a un cliente; hay un apartado para las que faltan por liquidar, con
abonos parciales o liquidación total.

| Entregable                                                                                  | Estado |
| ------------------------------------------------------------------------------------------- | ------ |
| Schema: `customers`, `credit_accounts`, `credit_payments` · pago `CREDIT` (mig. 0001)       | ✅     |
| `GET/POST /api/clientes` (COBRADOR alta rápida) · `PUT/DELETE` (ADMIN, 409 con deuda)       | ✅     |
| `GET /api/cuentas` (filtros estado/cliente/fecha) · `/total` · `/:id` (detalle + abonos)    | ✅     |
| `POST /api/cuentas/:id/abono` — valida monto ≤ saldo, exige caja abierta, liquida al saldar | ✅     |
| Venta a crédito: exige cliente activo, abono inicial opcional en efectivo                   | ✅     |
| CobroModal: método **Fiado** con selector / alta rápida de cliente                          | ✅     |
| Cobrador: pantalla `Cuentas` + `CuentaDetalleModal` (abono / botón "Liquidar")              | ✅     |
| Admin: `Clientes` (CRUD + saldo) y `Cuentas por cobrar` (filtros)                           | ✅     |
| Corte de caja: el efectivo esperado suma enganches y abonos en efectivo                     | ✅     |
| Dashboard "Por cobrar (fiado)" · reportes "crédito otorgado" · evento `cuenta:abono`        | ✅     |

### Módulo extra — Precio editable, venta por peso y clientes ✅

| Entregable                                                                                       | Estado |
| ------------------------------------------------------------------------------------------------ | ------ |
| Precio editable en el carrito (`CartLineInput.price?`), con auditoría en `original_price`        | ✅     |
| `VentaDetalleModal` muestra "precio editado ($orig → $final)" cuando aplica                      | ✅     |
| Productos por peso: `products.unit` (`PIEZA`/`KG`), precio por kg, cantidad en gramos            | ✅     |
| Carrito: input de gramos + botones rápidos 100 g / 250 g / 500 g / 1 kg para productos por kg    | ✅     |
| Ticket y detalle de venta formatean gramos/kg (`formatQty`)                                      | ✅     |
| `sales.customerId`: toda venta puede llevar cliente (opcional salvo Fiado, ahí obligatorio)      | ✅     |
| Admin → Ventas muestra columna Cliente; ticket imprime "Cliente: X" si hay                       | ✅     |
| Admin → Clientes simplificado a tabla estática de nombres (el saldo se ve en Cuentas por cobrar) | ✅     |
| `CobroModal`: buscador de cliente con sugerencias; un nombre nuevo se crea solo al confirmar     | ✅     |

### Módulo extra — Seguridad del licenciamiento ✅

| Entregable                                                                      | Estado |
| ------------------------------------------------------------------------------- | ------ |
| Licencias firmadas con Ed25519: la app/servidor sólo tienen la clave pública    | ✅     |
| Clave privada fuera del repo (`pnpm license:keygen` → `~/.config/spartan-pos/`) | ✅     |
| Los builds congelan la clave pública (no se puede sustituir vía entorno)        | ✅     |
| Freno de 5 intentos fallidos/minuto por IP en `POST /api/licencia/activar`      | ✅     |

### Sprint 8 — QA, Pulido y Empaquetado 🚧

| Entregable                                                                         | Estado     |
| ---------------------------------------------------------------------------------- | ---------- |
| Flujo completo verificado (activación → login → caja → ventas → cierre → reportes) | ✅         |
| QA: la licencia falla si se copia a otro equipo (fingerprint distinto)             | ✅         |
| `busy_timeout` en SQLite · `ErrorBoundary` en el Renderer                          | ✅         |
| Cobro operable con ratón: botones de monto rápido en efectivo                      | ✅         |
| Empaquetado validado con `electron-builder --dir` (arranca, migraciones, nativo)   | ✅         |
| `docs/guia-cobrador.html` — guía de 1 página imprimible                            | ✅         |
| `docs/empaquetado-e-instalacion.md`                                                | ✅         |
| Generar el `.exe` NSIS (requiere Windows/CI) · instalación + capacitación          | ⬜ cliente |

### Fase 2 — Servidor local multicajero 🟡 (base lista)

El mismo Fastify + Socket.io + lógica de negocio corre fuera de Electron, contra
PostgreSQL, sirviendo la SPA a tabletas por navegador. Runbook completo en
[`docs/fase-2-migracion.md`](docs/fase-2-migracion.md).

| Entregable                                                                              | Estado     |
| --------------------------------------------------------------------------------------- | ---------- |
| Capa de datos asíncrona y agnóstica del motor (`DATABASE_URL` elige SQLite/PostgreSQL)  | ✅         |
| Esquema + migraciones PostgreSQL (`schema.pg.ts`, `pnpm db:generate:pg`)                | ✅         |
| `verify:backend:pg` — ~145 checks contra PostgreSQL (PGlite, sin servidor)              | ✅         |
| Servidor sin Electron (`src/server/`) — `0.0.0.0:3000`, sirve la SPA, fallback de rutas | ✅         |
| Cliente resuelve el `baseURL` solo (mismo origen cuando lo sirve el servidor)           | ✅         |
| `pnpm build:server` → `dist-server/` (bundle + `public/` + migraciones + pm2 + `.env`)  | ✅         |
| Script de migración de datos `pnpm migrate:sqlite-to-pg`                                | ✅         |
| `deploy/ecosystem.config.cjs` (pm2) · runbook `docs/fase-2-migracion.md`                | ✅         |
| Instalar PostgreSQL, IP fija, firewall, `pm2-installer`, impresora en red               | ⬜ cliente |

## Requisitos

- Node.js 20+ (desarrollado con 24)
- **pnpm 10+** (`corepack enable` o `npm i -g pnpm`) — es el gestor de paquetes del proyecto
- Windows para generar el instalador `.exe` (el build multiplataforma de electron-builder
  requiere el SO objetivo o CI de Windows)

## Puesta en marcha

```bash
pnpm install           # instala deps y reconstruye better-sqlite3 para Electron (postinstall)
pnpm db:generate       # regenera las migraciones SQL si cambia src/main/db/schema.ts
pnpm dev               # arranca Electron + Vite (HMR) + Fastify :3001
```

Al primer arranque se crea la base de datos en `app.getPath('userData')/pos.db`, se aplican
las migraciones y se ejecuta el seed.

- **Login**: `admin / admin123` (administrador) · `cajero / cajero123` (cobrador)
- **Activación**: la app arranca en `/activation`. Copia el _ID de este equipo_ que muestra
  la pantalla y genera su clave con `pnpm license:gen <ID>` en el equipo del proveedor (firma
  con la clave privada, ver [Empaquetado](#empaquetado)). Pega la clave para activar. En
  `pnpm dev` también: `pnpm license:gen --here`.

> **Nota pnpm**: los scripts de instalación están autorizados en `pnpm-workspace.yaml`
> (`allowBuilds`). Si `pnpm install` avisa de _ignored build scripts_, ejecuta
> `pnpm approve-builds --all` una vez.

## Verificación sin GUI

```bash
pnpm verify:backend
```

Levanta store + SQLite + migraciones + seed + Fastify en un entorno temporal y valida el
flujo completo de los Sprints 0–8 más los módulos extra (~145 comprobaciones):
ping + Zod, licencia por hardware (incl. copia a otro equipo → inactiva), auth y roles,
catálogo, apertura/venta/cierre de caja con folio y cambio, respaldo, CRUD de
productos/categorías/usuarios con imagen, historial de ventas y cortes, reportes con
exportación a Excel/PDF, configuración, dashboard, ventas a crédito con abonos y
liquidación (corte que suma enganches y abonos en efectivo), precio editado con auditoría,
venta por peso (kg/gramos), y cliente asociado a cualquier venta.
Se ejecuta con Electron en modo `ELECTRON_RUN_AS_NODE` para usar el mismo ABI nativo que la app.

```bash
pnpm verify:backend:pg   # las mismas comprobaciones contra PostgreSQL (PGlite embebido)
```

## Empaquetado

- **Licencias:** el par Ed25519 se generó UNA vez con `pnpm license:keygen`. La clave privada
  vive en `~/.config/spartan-pos/license-private.pem` (fuera del repo, **respaldarla**); la
  pública está en `PRODUCTION_PUBLIC_KEY` (`src/main/services/license.ts`). Compilar no
  necesita secretos. Si la privada se filtra: nuevo par, build nuevo y re-licenciar a todos.
- `pnpm build:win` (**en Windows** o CI de Windows) → `dist-electron/pos-spartan-tech-<ver>-setup.exe` (NSIS).
- `pnpm exec electron-builder --dir` → build sin comprimir de la plataforma actual, para validar
  el empaquetado (migraciones en `resources/migrations`, `better-sqlite3` en `app.asar.unpacked`).
- Detalle en [`docs/empaquetado-e-instalacion.md`](docs/empaquetado-e-instalacion.md);
  guía del cobrador en [`docs/guia-cobrador.html`](docs/guia-cobrador.html) (imprimible).

## Otros comandos

```bash
pnpm typecheck            # tsc para main/preload/server y para renderer
pnpm lint                 # ESLint + Prettier
pnpm build                # typecheck + bundles de producción en out/
pnpm build:win            # build + instalador NSIS en dist-electron/  (Windows)
pnpm db:studio            # Drizzle Studio contra .data/pos.dev.db
pnpm license:gen <fp>     # genera la clave de licencia para un fingerprint (uso interno)
pnpm license:keygen       # crea el par Ed25519 de licencias (una sola vez)

# Fase 2 (servidor en red)
pnpm db:generate:pg       # regenera resources/migrations-pg si cambia schema.pg.ts
pnpm server:dev           # corre el servidor standalone en :3000 (PGlite, sirve out/renderer)
pnpm build:server         # empaqueta dist-server/ para desplegar con pm2
pnpm migrate:sqlite-to-pg # copia los datos de una pos.db a PostgreSQL
```

## Arquitectura

**Fase 1 — Electron de escritorio (SQLite)**

```
Electron
├── Main Process (Node)
│   ├── Fastify  ── HTTP :3001 ──┐
│   ├── Socket.io                │  El Renderer SÓLO habla HTTP/WS.
│   ├── Drizzle + better-sqlite3 │  Nada de ipcRenderer para lógica de negocio.
│   └── SQLite (userData/pos.db) │
└── Renderer (Chromium + React) ─┘
        fetch('http://localhost:3001/api/...')
```

**Fase 2 — Servidor en red local (PostgreSQL)** — mismo código, sin Electron

```
PC servidor ── pm2 ── node server.cjs :3000
               ├── Fastify + Socket.io + build de React
               └── Drizzle + node-postgres ── PostgreSQL 16 :5432

Tabletas / laptop ── Chrome ── http://192.168.1.10:3000/  (mismo origen para API y WS)
```

El swap lo decide `DATABASE_URL`: sin ella, SQLite; con ella, PostgreSQL. Ver
[`docs/fase-2-migracion.md`](docs/fase-2-migracion.md).

### Regla de oro

```ts
// ✅ el renderer habla HTTP, igual que en Fase 2
const productos = await api.get('/api/productos')

// ❌ prohibido — amarra el código a Electron para siempre
const productos = await window.electron.ipcRenderer.invoke('get-productos')
```

`ipcRenderer` queda reservado para lo que sólo existe en Electron: controles de ventana,
impresión (fallback), licencia y rutas del sistema de archivos.

## Estructura

```
src/
├── main/                  Proceso principal (Node.js)
│   ├── index.ts           Entry point: store + backend + ventana
│   ├── server.ts          Fastify (CORS, error handler, rutas)
│   ├── socket.ts          Socket.io + helper emit()
│   ├── socket-events.ts   Constantes de eventos (Fase 2-ready)
│   ├── paths.ts           Rutas de userData / migraciones / uploads
│   ├── db/                schema.ts (8 tablas) · index.ts (migrador runtime) · seed.ts
│   ├── routes/            ping · license · auth · usuarios · productos · categorias · caja · ventas · reportes · config · dashboard
│   ├── services/          license · auth · usuarios · productos · categorias · caja · ventas · printer · backup · config · reportes · reports-{excel,pdf} · dashboard
│   ├── middleware/        auth (requireAuth / requireRole)
│   └── lib/               validate (Zod) · store · jwt · http-error · money
├── renderer/src/          React
│   ├── api/               client (fetch + token + 401) · auth · license · catalogo · caja · ventas · admin
│   ├── assets/main.css    Tailwind v4 + tema claro (admin) / oscuro (cobrador)
│   ├── lib/               utils (cn) · routing · format (money) · socket (socket.io-client)
│   ├── stores/            auth.store · license.store · cart.store · socket.store (Zustand)
│   ├── components/        ProtectedRoute · AuthShell · SessionBar · Modal · ProductoBtn · CarritoItem · CobroModal · admin/{ProductoFormModal,CategoriaFormModal,UsuarioFormModal,VentaDetalleModal}
│   ├── pages/             Activation · Login · cobrador/{Layout,PanelVenta,CajaApertura,CajaCierre} · admin/{Layout,Dashboard,Productos,Categorias,Usuarios,Ventas,Cortes,Reportes,Configuracion}
│   └── App.tsx            HashRouter + arranque (consulta licencia)
└── shared/types.ts        Contrato de tipos Main ↔ Renderer
```

## Notas de implementación

- **Migraciones**: `drizzle-kit` sólo **genera** el SQL (`resources/migrations/`). Se **aplican**
  en runtime desde `src/main/db/index.ts` para evitar el conflicto de ABI de `better-sqlite3`
  entre el Node del sistema y el de Electron. electron-builder empaqueta la carpeta como
  `extraResources`.
- **bcrypt → bcryptjs**: se usa `bcryptjs` (JS puro, hashes compatibles, `saltRounds: 12`) en
  lugar del binding nativo `bcrypt` para no arrastrar un segundo módulo nativo. Cambio de
  implementación, no de comportamiento.
- **Licencia**: `fingerprint = SHA-256(uuid | MAC | serie de disco | hostname)`; la clave es
  la firma Ed25519 de `spartan-pos-license-v1:<fingerprint>` en base32 (~103 caracteres).
  Validación 100 % offline con la clave **pública** embebida: la app y el servidor no tienen
  nada que permita fabricar claves (antes era un HMAC con un secreto que viajaba en el `.env`
  / el `.exe`). La privada sólo está en la máquina del proveedor. `POS_LICENSE_PUBLIC_KEY`
  sustituye la pública sólo al correr desde el código (tests); electron-vite y tsup la
  congelan a vacío en los builds. Freno de intentos por IP en el endpoint de activación.
  Límite honesto: nada offline impide parchear el binario para saltarse la verificación.
- **Secreto JWT**: se genera aleatorio en el primer arranque y se guarda cifrado en
  `electron-store` — no es una constante en el binario. Token de 8 h, sólo en memoria en el
  cliente (nunca `localStorage`).
- **electron-store** es ESM-only; `src/main/lib/store.ts` normaliza el import para que
  funcione tanto en el bundle CJS de electron-vite como en el script de verificación (ESM).
- **Ventas**: `POST /api/ventas` corre en una transacción. El nombre siempre se toma de la BD
  (snapshot en `sale_items`); el precio también, salvo que el cajero lo edite en el momento
  (queda `original_price` como rastro de auditoría). `ticketNumber` es un folio secuencial por
  sesión de caja. Vender sin caja abierta → 409. Cantidad entera si el producto es `PIEZA`,
  decimal (kg) si es `KG` — la unidad viaja como snapshot en `sale_items.unit`. `customerId` es
  opcional salvo en pago `CREDIT`, donde es obligatorio.
- **Impresora**: `config.printer_interface` (vacío = deshabilitada). Ejemplos:
  `printer:XP-80T` (driver de Windows, requiere añadir un módulo nativo de impresión),
  `tcp://IP:9100` (impresora de red, sin dependencias). La impresión nunca hace fallar la
  venta: si no sale el ticket, la respuesta trae `print.printed = false`.
- **Respaldo**: al cerrar caja se copia `pos.db` a `config.backup_dir` (o `<userData>/backups`
  por defecto) con marca de tiempo; se conservan los últimos 30. Nunca bloquea el cierre.
- **Cierre de caja**: `expectedAmount = apertura + ventas en efectivo`;
  `difference = contado − esperado` (negativo = faltante, positivo = sobrante).
- **Timestamps**: Unix en segundos (`integer`), sin conversiones entre SQLite y PostgreSQL.
- **Fase 2**: cambiar el driver en `src/main/db/index.ts` (better-sqlite3 → node-postgres) y la
  `API_BASE_URL` en `src/renderer/src/api/client.ts`. El resto del código no cambia.
