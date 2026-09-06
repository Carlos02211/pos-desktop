# POS SpArTaN Tech

Sistema de Punto de Venta de escritorio para Windows 10/11 (Electron + React + Fastify + SQLite).
Arquitectura preparada para migrar en Fase 2 a un servidor local multicajero sin reescribir la
lógica de negocio.

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

| Entregable                                                         | Estado |
| ------------------------------------------------------------------ | ------ |
| Fingerprint SHA-256 del hardware (`systeminformation`)             | ✅     |
| Licencia offline por HMAC, store cifrado (`electron-store`)        | ✅     |
| Pantalla de activación `/activation` (muestra el ID del equipo)    | ✅     |
| `GET /api/licencia/estado` · `POST /api/licencia/activar`          | ✅     |
| Login bcrypt + JWT (8 h), secreto por instalación                  | ✅     |
| `POST /api/auth/login` · `/logout` · `GET /api/auth/me`            | ✅     |
| `requireAuth` / `requireRole` (ADMIN pasa siempre)                 | ✅     |
| Pantalla `/login`, `auth.store` (token en memoria)                 | ✅     |
| `ProtectedRoute` + guards de rol (`/cobrador`, `/admin`)           | ✅     |
| Seed: `admin / admin123` (ADMIN) · `cajero / cajero123` (COBRADOR) | ✅     |
| Generador de claves `pnpm license:gen`                             | ✅     |

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
  la pantalla y genera su clave con `pnpm license:gen <ID>` (en el equipo del proveedor, con
  el mismo `POS_VENDOR_SECRET`). Pega la clave para activar.

> **Nota pnpm**: los scripts de instalación están autorizados en `pnpm-workspace.yaml`
> (`allowBuilds`). Si `pnpm install` avisa de _ignored build scripts_, ejecuta
> `pnpm approve-builds --all` una vez.

## Verificación sin GUI

```bash
pnpm verify:backend
```

Levanta store + SQLite + migraciones + seed + Fastify en un entorno temporal y valida el
flujo completo de los Sprints 0–8 (~112 comprobaciones): ping + Zod, licencia por hardware
(incl. copia a otro equipo → inactiva), auth y roles, catálogo, apertura/venta/cierre de caja
con folio y cambio, respaldo, CRUD de productos/categorías/usuarios con imagen, historial de
ventas y cortes, reportes con exportación a Excel/PDF, configuración y dashboard.
Se ejecuta con Electron en modo `ELECTRON_RUN_AS_NODE` para usar el mismo ABI nativo que la app.

## Empaquetado

- `pnpm build:win` (**en Windows** o CI de Windows) → `dist-electron/pos-spartan-tech-<ver>-setup.exe` (NSIS).
- `pnpm exec electron-builder --dir` → build sin comprimir de la plataforma actual, para validar
  el empaquetado (migraciones en `resources/migrations`, `better-sqlite3` en `app.asar.unpacked`).
- Detalle en [`docs/empaquetado-e-instalacion.md`](docs/empaquetado-e-instalacion.md);
  guía del cobrador en [`docs/guia-cobrador.html`](docs/guia-cobrador.html) (imprimible).

## Otros comandos

```bash
pnpm typecheck         # tsc para main/preload y para renderer
pnpm lint              # ESLint + Prettier
pnpm build             # typecheck + bundles de producción en out/
pnpm build:win         # build + instalador NSIS en dist-electron/  (Windows)
pnpm db:studio         # Drizzle Studio contra .data/pos.dev.db
pnpm license:gen <fp>  # genera la clave de licencia para un fingerprint (uso interno)
```

## Arquitectura

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
  `base32(HMAC-SHA256(fingerprint, POS_VENDOR_SECRET))[:25]`. Validación 100 % offline. El
  `POS_VENDOR_SECRET` debe ser el mismo en la app empaquetada y en `pnpm license:gen`
  (variable de entorno; hay un valor por defecto sólo para desarrollo).
- **Secreto JWT**: se genera aleatorio en el primer arranque y se guarda cifrado en
  `electron-store` — no es una constante en el binario. Token de 8 h, sólo en memoria en el
  cliente (nunca `localStorage`).
- **electron-store** es ESM-only; `src/main/lib/store.ts` normaliza el import para que
  funcione tanto en el bundle CJS de electron-vite como en el script de verificación (ESM).
- **Ventas**: `POST /api/ventas` corre en una transacción. El precio y el nombre se toman de
  la BD (snapshot en `sale_items`), nunca del cliente. `ticketNumber` es un folio secuencial
  por sesión de caja. Vender sin caja abierta → 409.
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
