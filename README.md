# POS SpArTaN Tech

Sistema de Punto de Venta de escritorio para Windows 10/11 (Electron + React + Fastify + SQLite).
Arquitectura preparada para migrar en Fase 2 a un servidor local multicajero sin reescribir la
lógica de negocio.

## Estado — Sprint 0 ✅

| Entregable                                                  | Estado |
| ----------------------------------------------------------- | ------ |
| Scaffold electron-vite (React + TypeScript)                 | ✅     |
| Tailwind CSS v4 + tokens de marca + base shadcn/ui          | ✅     |
| Drizzle ORM + better-sqlite3 + `schema.ts` (8 tablas)       | ✅     |
| Primera migración (`resources/migrations/0000_*.sql`)       | ✅     |
| Servidor Fastify en el Main Process (`localhost:3001`)      | ✅     |
| Socket.io montado sobre el mismo servidor HTTP              | ✅     |
| Endpoint `/api/ping` (Renderer → Fastify → SQLite)          | ✅     |
| Seed idempotente: `admin / admin123` + categoría + producto | ✅     |
| `electron-builder.yml` (NSIS x64, español)                  | ✅     |
| Estructura de carpetas del árbol del proyecto               | ✅     |

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
las migraciones y se ejecuta el seed. Credenciales por defecto: **admin / admin123**.

> **Nota pnpm**: los scripts de instalación están autorizados en `pnpm-workspace.yaml`
> (`allowBuilds`). Si `pnpm install` avisa de _ignored build scripts_, ejecuta
> `pnpm approve-builds --all` una vez.

## Verificación sin GUI

```bash
pnpm verify:backend
```

Levanta SQLite + migraciones + seed + Fastify en un entorno temporal y valida `/api/ping`,
el seed y la validación Zod. Se ejecuta con Electron en modo `ELECTRON_RUN_AS_NODE` para
usar el mismo ABI nativo de `better-sqlite3` que la app.

## Otros comandos

```bash
pnpm typecheck         # tsc para main/preload y para renderer
pnpm lint              # ESLint + Prettier
pnpm build             # typecheck + bundles de producción en out/
pnpm build:win         # build + instalador NSIS en dist-electron/
pnpm db:studio         # Drizzle Studio contra .data/pos.dev.db
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
│   ├── index.ts           Entry point: arranca backend + ventana
│   ├── server.ts          Fastify (CORS, error handler, rutas)
│   ├── socket.ts          Socket.io + helper emit()
│   ├── socket-events.ts   Constantes de eventos (Fase 2-ready)
│   ├── paths.ts           Rutas de userData / migraciones / uploads
│   ├── db/
│   │   ├── schema.ts      8 tablas Drizzle (SQLite)
│   │   ├── index.ts       createDb / initDb (migrador en runtime) / getDb
│   │   └── seed.ts        Seed idempotente
│   ├── routes/            index.ts + ping.ts (auth, productos, ... en próximos sprints)
│   ├── lib/               validate.ts (helpers Zod)
│   ├── services/          printer, license, backup, reportes (próximos sprints)
│   └── middleware/        auth (Sprint 1)
├── renderer/src/          React
│   ├── api/               client.ts (fetch + token) + ping.ts
│   ├── assets/main.css    Tailwind v4 + tema claro (admin) / oscuro (cobrador)
│   ├── lib/utils.ts       cn() de shadcn/ui
│   ├── stores/            Zustand (Sprint 1+)
│   ├── pages/             cobrador/ y admin/ (Sprint 2+)
│   └── components/ui/     shadcn/ui (se añaden con `npx shadcn add`)
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
- **Timestamps**: Unix en segundos (`integer`), sin conversiones entre SQLite y PostgreSQL.
- **Fase 2**: cambiar el driver en `src/main/db/index.ts` (better-sqlite3 → node-postgres) y la
  `API_BASE_URL` en `src/renderer/src/api/client.ts`. El resto del código no cambia.
