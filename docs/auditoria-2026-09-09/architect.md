# Auditoría de arquitectura — POS desktop (Fase 2)

Modo: READ-ONLY. Fecha: 2026-09-09. Rama `main`, diff grande sin commitear.

Alcance revisado: `src/main/**` (backend Fastify + Drizzle), `src/server/**` (servidor standalone),
`src/shared/types.ts`, `src/renderer/src/api/**`, `src/renderer/src/lib/socket.ts`,
`src/renderer/src/stores/socket.store.ts`, capa de datos (`src/main/db/**`), migraciones
(`resources/migrations*`), y el diff de trabajo.

Prioridad: **Crítico** = corregir antes de desplegar Fase 2 · **Alto** = corregir en esta iteración ·
**Medio** = planificar · **Bajo** = anotar.

---

## CRÍTICO

### C1. `withTx()` sobre SQLite no es seguro bajo concurrencia — la premisa del comentario es falsa
`src/main/db/tx.ts:8-11,19-32`

El comentario afirma: *"es seguro porque el driver es síncrono: no hay hueco real de asincronía
entre sentencias"*. Es incorrecto. El callback de `createSale` (`src/main/services/ventas.ts:53-170`)
hace **múltiples `await`** (select productos, select `max(ticketNumber)`, insert venta, N inserts de
líneas, insert cuenta, select usuario). Cada llamada a better-sqlite3 es síncrona, pero **el `await`
cede el event loop entre sentencias**. Una segunda petición concurrente que entre en `withTx` emitirá
`BEGIN` mientras la transacción de la primera sigue abierta →
`SQLite: cannot start a transaction within a transaction`, o peor: sus sentencias se ejecutan
**dentro de la transacción ajena** y se hacen commit/rollback con ella.

En Fase 1 (un solo Renderer) es improbable pero no imposible (doble submit, refetch en vivo durante
una venta). En Fase 2 sobre SQLite (varias tabletas) es un fallo seguro de corrupción/consistencia.

Recomendación:
- Si Fase 2 = PostgreSQL siempre, **documentar que SQLite es mono-cliente** y forzar en el arranque
  del servidor standalone que `DATABASE_URL` esté presente (fallar si no).
- Si SQLite debe soportar >1 cliente: serializar TODA la ruta de escritura con una cola/mutex
  (`async-mutex`) alrededor de `withTx` en dialecto sqlite, o reescribir el cuerpo de las
  transacciones como función **síncrona** y usar `better-sqlite3.transaction()` nativo.
- Corregir el comentario para que no induzca a error.

### C2. Impresión de tickets: un único `printer_interface` global para N cajas
`src/main/services/printer.ts:56-58`, `src/main/routes/ventas.ts:63`, `config` (tabla, clave única)

La interfaz de impresora vive en **una sola fila** `config.printer_interface`. En multicajero cada
tableta/estación necesita su propia impresora de tickets; con el diseño actual todas imprimirían en
la misma impresora (la que esté configurada en el servidor) o ninguna. Además el servidor standalone
corre en Windows bajo pm2: no tiene acceso a las impresoras USB de cada puesto.

Recomendación: mover la impresión al cliente (Renderer imprime contra la impresora local del puesto
vía el SO / WebUSB / agente local), o introducir configuración de impresora **por dispositivo**
(clave `printer_interface:<deviceId>` y `deviceId` enviado por el cliente). Decidir antes de vender
Fase 2 como "multicajero".

### C3. Diff de trabajo sin commitear con cambio de esquema + migraciones + reglas de negocio
`git status` (826 inserciones / 332 borrados en 38 archivos, sobre `main`, sin rama)

En un solo árbol sucio conviven: cambio de esquema en ambos dialectos, 3+3 migraciones nuevas
(archivos *untracked*), cambio de tipo de dinero/cantidad, nueva regla "precio editable por cajero",
"venta por KG", "cliente en cualquier venta", borrado de `ClienteFormModal`, y refactor de UI. Es
irreproducible, no bisecable y no revisado. Si se pierde el árbol o se re-ejecuta `pnpm db:generate`,
el estado de BD y el esquema divergen.

Recomendación: crear rama, commitear en bloques lógicos (1: esquema + migraciones + test de paridad;
2: lógica de servicios; 3: Renderer), y añadir los `.sql`/`meta/*.json` nuevos al control de versiones
ya (son *untracked*).

---

## ALTO

### A1. Dos esquemas Drizzle mantenidos a mano, sin prueba de paridad
`src/main/db/schema.sqlite.ts`, `src/main/db/schema.pg.ts`, `src/main/db/schema.ts:17`

La apuesta central de Fase 2 (agnóstico de motor) depende de que `schema.sqlite.ts` y `schema.pg.ts`
declaren *exactamente* las mismas tablas/columnas/nullability. Hoy lo único que lo garantiza es la
disciplina del autor (el diff tuvo que tocar los dos y dos carpetas de migraciones). `schema.ts:17`
hace `as unknown as typeof pgSchema` — un cast que **silencia** cualquier divergencia de tipos.

Recomendación: test automatizado (en `verify:backend` y CI) que arranque ambos dialectos, introspeccione
`information_schema` / `pragma table_info`, y asevere igualdad de columnas, tipos lógicos y nullability.
Alternativa más fuerte: generar un esquema desde el otro, o desde una definición única.

### A2. `DB` tipado sólo como `NodePgDatabase` — la ruta SQLite no tiene garantías de compilación
`src/main/db/index.ts:25,54,64,80`, `src/main/db/schema.ts:14-17`

Todo se castea `as unknown as DB`. Una query válida sólo en PG (o sólo en SQLite) compila sin error y
revienta en runtime en el otro motor. `pingDb` (`index.ts:136-143`) ya evidencia la fuga: hace
`db.execute()` vs `(db as ...).get()` según dialecto con casts manuales. `withTx` hace lo mismo con
`.run()`.

Recomendación: tipar `DB` como unión (`NodePgDatabase<S> | BetterSQLite3Database<S>`) y dejar que el
compilador obligue a usar sólo el subconjunto común, o introducir una interfaz `Repository` fina que
oculte las diferencias (`execute`, `transaction`, `raw`).

### A3. Socket.io sin autenticación ni salas — expone datos financieros a toda la LAN
`src/main/socket.ts:16-19,33-35`, `src/renderer/src/lib/socket.ts:10-13`, `src/renderer/src/stores/socket.store.ts`

`io.on('connection')` no valida JWT (comentario: *"En Fase 2 aquí se autenticará"* — pendiente). El
cliente conecta con `io(API_BASE_URL)` sin `auth`. `emit()` hace `_io.emit` global: **todos** los
dispositivos reciben `venta:nueva` (con `total`), `caja:cierre` (con `difference`), etc. Cualquier
equipo en la wifi puede conectarse y escuchar toda la actividad de caja.

Recomendación (antes de Fase 2 en producción):
- `io.use()` que verifique el JWT de `socket.handshake.auth.token`; rechazar conexión si inválido.
- Pasar el token desde el Renderer: `io(url, { auth: { token } })` y reconectar al renovar sesión.
- Segmentar por salas/rol si un COBRADOR no debe ver cifras de otros (`socket.join('role:ADMIN')`).

### A4. `itemCount` ahora suma cantidades fraccionarias (KG) — dato roto
`src/main/services/ventas.ts:204`, `src/main/services/dashboard.ts:52` (`sum(${saleItems.quantity})`)

Con el cambio a KG, `quantity` puede ser 0.35. El campo `itemCount` (tipado `number`, mostrado como
"nº de artículos") pasa a valer p. ej. `3.35`. Regresión introducida por el diff.

Recomendación: `count(*)` sobre `sale_items`, o
`sum(case when unit = 'PIEZA' then quantity else 1 end)`.

### A5. Sin índices en claves foráneas ni en columnas de filtro/orden
`src/main/db/schema.*.ts` (sólo hay UNIQUE en `users.username`, `categories.name`)

`sales.cashSessionId`, `sales.userId`, `sales.customerId`, `sales.createdAt`, `saleItems.saleId`,
`creditAccounts.customerId`, `creditAccounts.status`, `creditPayments.cashSessionId` — todas se usan en
JOIN/WHERE/ORDER BY sin índice (`listSales` ordena por `createdAt` con OFFSET y una subconsulta
correlacionada por fila). En SQLite de escritorio pasa desapercibido; en PostgreSQL multicajero con
años de historial degrada de forma notable.

Recomendación: añadir índices en esas columnas en ambos esquemas y regenerar migraciones ahora que ya
se está tocando el esquema.

### A6. Carreras check-then-write no protegidas (graves sólo en PostgreSQL/multicajero)
- `src/main/services/ventas.ts:118-122` — `ticketNumber = max(...)+1` dentro de la tx; dos ventas
  concurrentes en la misma sesión de caja pueden obtener el mismo folio (READ COMMITTED). Falta
  `UNIQUE(cash_session_id, ticket_number)`.
- `src/main/services/caja.ts:23-38` — `openSession` hace `getActiveSession` y luego `insert`; dos
  aperturas concurrentes → dos sesiones OPEN. Falta índice único parcial
  `WHERE status = 'OPEN'` sobre `user_id`.
- `src/main/services/cuentas.ts:137-171` — `addAbono` lee `account.paid` y actualiza; dos abonos
  concurrentes pueden ambos pasar la validación `amount > balance` → sobrepago. Falta
  `SELECT ... FOR UPDATE` (PG) o versión optimista.

SQLite serializa escrituras y las tapa; PostgreSQL no. Son bugs reales del objetivo Fase 2.

### A7. Dinero como coma flotante en PostgreSQL
`src/main/db/schema.pg.ts` (`doublePrecision` en price/total/amountPaid/subtotal/...), `schema.sqlite.ts` (`real`)

Los `round2/round3` mitigan la acumulación pero `SUM()` en SQL sobre `double precision`
(`caja.ts:56-64`, `cuentas.ts:180`, reportes) sigue arrastrando error en volúmenes grandes. Guardar
dinero como float es un anti-patrón en PG.

Recomendación: `NUMERIC(12,2)` en PostgreSQL (y enteros de centavos o `INTEGER` en SQLite), aprovechando
que ya se está escribiendo una migración. El cambio a "precio editable" y "cantidades KG" multiplica
las multiplicaciones float → mejor momento para corregirlo.

---

## MEDIO

### M1. Tres fuentes de verdad para el mismo contrato
`src/shared/types.ts` (interfaces) · `src/main/routes/*.ts` (schemas Zod) · `src/main/db/schema.ts` (`$inferSelect`)

Ej.: `CreateSaleInput` (interface) vs `createSaleSchema` (Zod) describen el mismo cuerpo por separado;
`SaleListItem` vs el `select({...})` de `listSales`. Ya hay deriva latente (ver M2). Mantener sincronía
es manual.

Recomendación: derivar los tipos de request desde Zod (`z.infer`) y exportarlos desde `shared/`, o
al menos co-locar interface + schema y añadir un test de forma.

### M2. Contrato inconsistente: filtro de historial por método `CREDIT`
`src/shared/types.ts:279` (`SalesQuery.paymentMethod?: PaymentMethod` — incluye `CREDIT`) vs
`src/main/routes/ventas.ts:18` (`z.enum(['CASH','CARD','TRANSFER'])` — sin `CREDIT`)

El tipo compartido promete que se puede filtrar por `CREDIT`; el servidor responde 400. El admin no
puede listar ventas fiadas.

Recomendación: añadir `'CREDIT'` al enum del schema (y a `listSales`), o estrechar el tipo compartido.

### M3. CORS y Socket.io con `origin: true` + `credentials: true` por defecto
`src/server/server.ts` no; `src/main/server.ts:67-70`, `src/main/socket.ts:12-14`,
`src/server/config.ts:50-52` (`allowedOrigins ?? true`)

Cuando `POS_ALLOWED_ORIGINS` no está definido, el servidor standalone refleja **cualquier** origen con
credenciales. La app usa Bearer token (no cookies), así que el riesgo real de CSRF es bajo, pero
cualquier web que el navegador de una tableta visite podría llamar a la API del POS en la LAN.
Además `origin: true` + `credentials: true` es una combinación inválida según la spec (los navegadores
la bloquean con cookies).

Recomendación: exigir `POS_ALLOWED_ORIGINS` explícito en el servidor standalone (fallar si falta),
o al menos restringir a la subred. Quitar `credentials: true` mientras la auth sea sólo por header.

### M4. Precio editable por el cajero sin límite ni aprobación
`src/main/routes/ventas.ts:29` (`price: z.number().positive().max(1_000_000).optional()`),
`src/main/services/ventas.ts:76-82`

Un COBRADOR puede fijar cualquier precio > 0 (vender todo a $0.01). Hay rastro (`originalPrice`) pero
ningún tope (p. ej. descuento máx. %, o requerir rol/PIN de ADMIN por encima de cierto descuento).
Riesgo de fraude/merma.

Recomendación: definir política (descuento máximo, o autorización de ADMIN), validarla en el servicio,
y exponer un reporte de ventas con precio editado.

### M5. Impresión síncrona en la ruta de la venta, sin timeout
`src/main/routes/ventas.ts:63` (`await printTicket(...)`), `src/main/services/printer.ts:71,114`

`isPrinterConnected()` + `execute()` sobre TCP/USB pueden colgarse hasta el timeout del driver. En
Fase 1 (un event loop) una impresora muerta bloquea el backend entero; en Fase 2 retiene el handler.

Recomendación: `Promise.race` con timeout de 3-5 s, o imprimir de forma totalmente asíncrona y
notificar el resultado por socket.

### M6. Detección de dialecto duplicada en 4 sitios
`src/main/db/index.ts:20-22` · `src/main/db/schema.ts:17` · `src/server/config.ts:42-44` ·
`scripts/verify-backend.ts`

Cada uno vuelve a leer `process.env.DATABASE_URL` con su propia lógica (incluida la detección de
`pglite:`). Si cambia el criterio, hay que tocar 4 lugares.

Recomendación: un único `resolveDbTarget()` que devuelva `{ dialect, url, isPglite, migrationsDir }`
y consumirlo desde todos.

### M7. `getJwtSecret` cifrado con clave constante embebida
`src/main/lib/store.ts:29` (`ENCRYPTION_KEY = 'SPARTAN_TECH_2026_SECRET'`), `store.ts:54-62`

El secreto JWT se genera aleatorio por instalación (bien) pero se guarda cifrado con una constante del
código fuente. Quien tenga el archivo `pos-config` + el fuente puede descifrarlo y **falsificar tokens**
de esa instalación. En Fase 2 el servidor Windows es un objetivo mayor.

Recomendación: derivar la clave de cifrado del store de algo no versionado (variable de entorno del
servicio, DPAPI en Windows), o al menos rotar/uniquificar por despliegue. Delegar profundización al
agente `security`.

### M8. `SalesQuery`/`itemCount`/joins repetidos entre `listSales` y `getDashboard`
`src/main/services/ventas.ts:190-213` y `src/main/services/dashboard.ts:40-60`

El `select({...})` de fila de venta (mismos campos, mismo `leftJoin(customers)`, misma subconsulta
`itemCount`) está copiado. Deriva asegurada (ya hay que arreglar A4 en dos sitios).

Recomendación: extraer un helper `saleListItemSelection(db)` / builder compartido.

### M9. Servidor standalone acarrea contexto SQLite-céntrico
`src/main/server.ts:11-28` (`ServerContext.dbPath`, `backupDir`), `src/main/routes/caja.ts:66-74`

`ServerContext` expone `dbPath` (ruta de archivo SQLite) aunque el servidor "agnóstico" corra en PG;
`caja.ts` ramifica `DIALECT === 'sqlite'` para el backup. La abstracción de datos filtra detalles del
motor a las rutas.

Recomendación: mover el respaldo detrás de una interfaz `BackupStrategy` inyectada (no-op / pg_dump /
copia de archivo) y sacar `dbPath` del contexto público.

---

## BAJO

### B1. Código muerto: `openCreditAccount` no se usa
`src/main/services/cuentas.ts:34-59` — `createSale` inserta la cuenta a crédito inline
(`ventas.ts:148-161`) en vez de llamar a este helper. Duplicación de la misma regla.

### B2. Endpoints huérfanos tras el recorte de "clientes"
El diff borra `ClienteFormModal.tsx` y `actualizarCliente/desactivarCliente` de
`src/renderer/src/api/cuentas.ts`, pero `PUT/DELETE /api/clientes/:id`
(`src/main/routes/clientes.ts:36-45`), `updateCustomer/deactivateCustomer` y el test en
`scripts/verify-backend.ts` siguen. Decidir: reactivar edición en el panel, o eliminar el backend
muerto. La página `Clientes.tsx` queda como alta de nombre sin editar/desactivar (¿regresión buscada?).

### B3. Throttle de licencia en memoria, `Map` sin purga
`src/main/routes/license.ts:15-30` — `failedAttempts` nunca se limpia de entradas vencidas (fuga
lenta) y se reinicia al reiniciar el proceso. Aceptable como defensa secundaria; añadir purga
periódica o `LRU`.

### B4. `revision` global dispara refetch en todas las pantallas por cada evento
`src/renderer/src/stores/socket.store.ts:18-25` — con N tabletas, cada venta hace que las N refresquen
listas/dashboard (amplificación O(n²) de fetch). En una tienda pequeña es inocuo; anotar como límite.
Los payloads de evento ya traen datos suficientes para actualización local.

### B5. `resolveApiBaseUrl` asume Electron en `import.meta.env.DEV`
`src/renderer/src/api/client.ts:19` — devuelve `http://localhost:3001` en cualquier build dev; si algún
día se hace `dev` del Renderer contra el servidor Fase 2 (puerto 3000) habría que usar
`VITE_API_BASE_URL`. Menor.

### B6. `_journal.json` sin newline final (ambas carpetas)
Trivial; algunos linters/CI lo marcan.

### B7. `addAbono` re-consulta el detalle completo (2 joins + subventa) tras cada abono
`src/main/services/cuentas.ts:173` — aceptable, pero es trabajo extra en la ruta de escritura.

---

## Notas positivas (no cambiar)

- Reutilización real entre Electron y servidor standalone: `src/server/index.ts` reusa
  `startServer` + todos los `services/` sin fork del backend. Duplicación mínima (solo el arranque).
- Frontera Renderer↔backend limpia: el Renderer sólo habla HTTP (`api/client.ts`), nada de IPC para
  negocio. `shared/types.ts` como contrato único.
- Manejo de errores homogéneo: `HttpError` + `ValidationError` + `err.validation` → un único
  `{ error, details? }` (`src/main/server.ts:103-112`), coincide con `ApiError`.
- Disciplina de validación: todos los endpoints hacen `parse(schema, ...)` con Zod.
- Endurecimiento de licencia en el diff: set de secretos filtrados, `crypto.timingSafeEqual`,
  `check-vendor-secret.ts` que corta el build, inyección en tiempo de compilación. Bien resuelto.
- `login` con hash dummy anti-enumeración por temporización (`src/main/services/auth.ts:11,16`).
- Socket.io como "sólo notificación, el cliente hace fetch" — patrón correcto y bien documentado.
