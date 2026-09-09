# Auditoría de Backend — POS SpArTaN Tech (READ-ONLY)

Fecha: 2026-09-09
Alcance: `src/main` (Fastify, rutas/servicios/lib/middleware), `src/server` (standalone), Drizzle SQLite/PG.
Contexto: diff grande sin commitear (unidad KG, precio de línea editable, cliente en venta, cuentas por cobrar).

Leyenda: **Crítico** = pérdida de dinero/datos o compromiso directo · **Alto** = corrupción de datos/lógica de negocio bajo uso normal concurrente · **Medio** = incorrecto en escenarios plausibles · **Bajo** = pulido / defensa en profundidad.

---

## CRÍTICO

### C1 — Credenciales por defecto `admin/admin123` en servidor expuesto a la LAN
`src/main/db/seed.ts:31-39` crea `admin/admin123` y `cajero/cajero123` y nunca fuerza el cambio.
`src/server/config.ts:31` + `deploy/.env.example:7` → `HOST=0.0.0.0`. Cualquier dispositivo de la red local llega a `POST /api/auth/login` y entra como ADMIN (usuarios, precios, config, exportaciones, reportes).
No hay rate limiting en login (no existe `@fastify/rate-limit`; sólo el throttle del endpoint de licencia).
**Recomendación:** obligar cambio de contraseña del admin en el primer arranque del servidor standalone (o no sembrar admin y exigir provisión por CLI); añadir rate limiting a `/api/auth/login`. Derivar hardening al agente `security`.

---

## ALTO

### A1 — `ticketNumber` con condición de carrera → folios duplicados
`src/main/services/ventas.ts:118-122`: `select coalesce(max(ticket_number),0)+1` dentro de la transacción, sin bloqueo. No hay índice único `(cash_session_id, ticket_number)` en `schema.sqlite.ts` / `schema.pg.ts`.
En PostgreSQL (Fase 2 multicajero, READ COMMITTED) dos ventas simultáneas de la misma sesión leen el mismo `max` y ambas insertan el mismo folio. Rompe la garantía de "folio secuencial por sesión" y el rastro de auditoría.
**Recomendación:** índice único `(cash_session_id, ticket_number)` + reintento; o `SELECT ... FOR UPDATE` sobre la fila de `cash_sessions`; o secuencia dedicada.

### A2 — Abonos concurrentes: `credit_accounts.paid` inconsistente con la suma de `credit_payments`
`src/main/services/cuentas.ts:137-171` (`addAbono`): lee `account.paid`, valida `amount <= balance`, inserta el pago y hace `set paid = account.paid + amount` (last-write-wins). Sin bloqueo de fila.
Dos abonos simultáneos a la misma cuenta: ambos leen `paid=0`, ambos insertan en `credit_payments`, el `UPDATE` final sólo refleja uno → `paid` queda por debajo de la suma real de pagos; el saldo mostrado (`total - paid`) es erróneo y la cuenta puede no liquidarse nunca. La validación `amount <= balance` usa saldo obsoleto, así que la suma de abonos puede superar el total.
**Recomendación:** `SELECT ... FOR UPDATE` de la cuenta dentro de la tx, o recalcular `paid` como `SELECT sum(amount) FROM credit_payments WHERE credit_account_id = ?` en el mismo statement.

### A3 — Precio de línea editable por el cajero sin límite ni autorización
Diff en `src/main/services/ventas.ts:76-82` y `src/main/routes/ventas.ts:29` (`price?` en `CartLineInput`). El servicio acepta cualquier `price > 0` hasta 1.000.000, sin tope de descuento, sin comparar contra `product.price`, sin exigir rol/PIN de ADMIN.
Un cajero puede sub-registrar ventas (cobrar de menos a un conocido) en CARD/TRANSFER/CREDIT — en CASH está limitado porque `amountPaid >= total`, pero en los demás métodos no. Sólo queda rastro parcial en `sale_items.original_price` (y sólo si difiere).
**Recomendación:** tope de descuento configurable (%/monto), o exigir override de ADMIN, o registrar el descuento como concepto auditable con `userId` autorizante. Como mínimo, rechazar `price > product.price` si el negocio no vende por encima de catálogo.

### A4 — Socket.io sin autenticación en el servidor standalone
`src/main/socket.ts:16-19`: el comentario dice "En Fase 2 aquí se autenticará el socket" — pero esto **es** Fase 2 y no está hecho. `emit()` hace `io.emit` a todos los conectados.
Cualquier dispositivo de la LAN se conecta al socket y recibe `venta:nueva` (totales), `caja:apertura`/`caja:cierre` (montos de efectivo), `cuenta:abono` (saldos y `customerId`). Divulgación de información de negocio.
**Recomendación:** middleware de handshake que valide el JWT (`io.use(...)`), y salas por rol/usuario para no difundir eventos de caja a todos.

### A5 — `openSession` con condición de carrera → varias cajas abiertas por usuario
`src/main/services/caja.ts:23-39`: comprueba `getActiveSession` y luego inserta, sin transacción ni índice único. No hay índice único parcial `(user_id) WHERE status='OPEN'`.
Dos `POST /api/caja/apertura` casi simultáneos crean dos sesiones OPEN. `getActiveSession` usa `limit(1)` (fila arbitraria); las ventas se reparten entre sesiones, un cierre cierra una y la otra queda abierta indefinidamente, cuadre incorrecto.
**Recomendación:** índice único parcial + capturar la violación; o `SELECT ... FOR UPDATE` / advisory lock por `userId`.

### A6 — Impresión y generación de PDF/Excel en el hilo del request
`src/main/routes/ventas.ts:63`: `await printTicket(...)` se ejecuta y se espera **antes** de responder 201. `node-thermal-printer` se construye sin `options.timeout` explícito (`src/main/services/printer.ts:63-70`) → depende del default de la librería; con impresora TCP inaccesible cada venta suma segundos de latencia. En el servidor standalone multicajero esto bloquea el event loop para todos.
`src/main/routes/reportes.ts:72` + `src/main/services/reports-pdf.ts:34` (`generateReportPdf` es **síncrona**, sin `await`): la generación de un PDF mensual bloquea el event loop varios segundos.
**Recomendación:** imprimir en segundo plano y notificar el resultado por socket / endpoint de estado; fijar `timeout` explícito bajo (p. ej. 3000 ms) en el `ThermalPrinter`; generar PDF/Excel en worker o al menos `await` con streaming.

---

## MEDIO

### M1 — CORS abierto por defecto en el servidor standalone
`src/main/server.ts:67-70` (`origin: opts.allowedOrigins ?? true`, `credentials: true`) + `src/server/config.ts:50-52` (default `true` si `POS_ALLOWED_ORIGINS` no está) + `.env.example` con la variable comentada. En un servidor en `0.0.0.0` esto refleja cualquier `Origin`. El impacto real está acotado porque el auth es Bearer en header (no cookie), pero deja los endpoints sin auth (`/api/auth/login`, `/api/licencia/*`) accesibles desde cualquier web que abra el cajero.
**Recomendación:** en producción exigir lista explícita de orígenes; no usar `origin: true` fuera de dev.

### M2 — `closeSession` no es atómico respecto a ventas en vuelo
`src/main/services/caja.ts:122-148`: `totalsFor` y el `UPDATE` a CLOSED no están en transacción. Una venta que pasó el chequeo `getActiveSession` antes del cierre puede commitear después de `totalsFor` → `expectedAmount`/`difference` guardados en el corte no incluyen ese efectivo. Cuadre incorrecto.
**Recomendación:** cerrar dentro de una tx que bloquee la sesión (`FOR UPDATE`) y recalcular totales dentro; rechazar ventas cuya sesión ya no esté OPEN al momento del commit.

### M3 — Emulación de transacción SQLite frágil bajo concurrencia
`src/main/db/tx.ts:19-32`: en SQLite se emula `BEGIN`/`COMMIT`/`ROLLBACK` sobre la conexión compartida. El comentario asume "no hay hueco real de asincronía", cierto sólo mientras `fn` no contenga awaits sobre I/O real. Hoy `createSale`/`addAbono` no lo hacen, pero es una invariante no forzada: cualquier `await` de red/FS dentro de un `withTx` futuro permitiría interleaving de dos requests → `BEGIN` anidado o un `COMMIT` que cierra la tx de otro request. Aplica al servidor standalone si corre con SQLite (fallback soportado, `HOST=0.0.0.0`).
**Recomendación:** serializar las transacciones SQLite (cola/mutex) o documentar y testear la invariante "cero I/O async dentro de withTx".

### M4 — Sin idempotencia en `POST /api/ventas`
`src/main/routes/ventas.ts:41`: un reintento de red o doble clic crea dos ventas idénticas (dos folios, doble impresión, doble cuenta por cobrar en CREDIT).
**Recomendación:** clave de idempotencia generada por el cliente (UUID) + índice único; devolver la venta existente si se repite.

### M5 — `round2` con `Number.EPSILON` insuficiente
`src/main/lib/money.ts:2-4`: `Math.round((n + Number.EPSILON) * 100) / 100`. `Number.EPSILON` (~2.2e-16) es relativo a 1; tras multiplicar por 100 el hueco de representación es mayor, así que casos como `round2(1.005)` siguen dando `1.00`. Con dinero en `double precision` y multiplicaciones `price * quantity` (sobre todo KG fraccional) hay deriva de centavos posible.
**Recomendación:** almacenar dinero en centavos enteros, o usar una librería decimal; si se mantiene el enfoque, redondear con tolerancia proporcional (`Math.round(n*100 + Math.sign(n)*1e-6)`).

### M6 — Zona horaria implícita en dashboard y reportes
`src/main/services/dashboard.ts:9-14` ("hora local del servidor") y `src/main/services/reportes.ts:21-46` (`new Date(\`${dateStr}T00:00:00\`)`, `.getHours()`, `.getMonth()`): todo depende del TZ del proceso. Un servicio pm2/Windows o contenedor en UTC desplaza "hoy", los cortes diarios y los buckets. Sin variable de configuración de zona horaria del negocio.
**Recomendación:** fijar `TZ` del proceso explícitamente y/o guardar la zona del negocio en `config` y calcular los rangos con ella.

### M7 — `POS_VENDOR_SECRET`: la doc dice "no arranca", el código sólo avisa
`src/main/services/license.ts:31-46` + `deploy/.env.example:22-24`. El `.env.example` afirma "Sin este valor (o con el de ejemplo) el servidor no arranca", pero el código sólo hace `console.warn` y sigue con `DEV_ONLY_SECRET`. El `.env.example` además trae un valor que está en `KNOWN_LEAKED_SECRETS`. Un operador puede desplegar creyendo que el arranque falla y quedar emitiendo licencias falsificables.
**Recomendación:** en `src/server/index.ts`, abortar el arranque si `VENDOR_SECRET === DEV_ONLY_SECRET` y `isDev === false`.

### M8 — `DUMMY_HASH` inválido en el login
`src/main/services/auth.ts:11`: `'$2b$12$0000...a'` no es un hash bcrypt bien formado (longitud de sal/hash incorrecta). Según el comportamiento de `bcryptjs` con un hash malformado: o retorna `false` de inmediato (sin coste KDF) → se rompe la mitigación de timing y vuelve a ser posible enumerar usuarios por temporización; o lanza → todo login con usuario inexistente devuelve 500 en vez de 401.
**Recomendación:** generar el dummy con `bcrypt.hashSync('x', 12)` una vez y hardcodear ese valor real.

### M9 — El cuadre de caja no contempla retiros/ingresos de efectivo
`src/main/services/caja.ts:88-90` (`expectedCashFor`): efectivo esperado = apertura + ventas efectivo + enganches + abonos. No existe el concepto de retiro de efectivo / ingreso de cambio / gasto de caja. Si el negocio saca dinero durante el turno, el cierre siempre marcará faltante.
**Recomendación:** tabla de movimientos de caja (`cash_movements`) sumada/restada en `expectedCashFor`, o documentar explícitamente que no se soportan retiros.

### M10 — `jwt_secret` se regenera si el directorio de datos no persiste
`src/main/lib/store.ts:54-62`: si `jwt_secret` no está en el store se genera uno nuevo. En el standalone `initStore(cfg.dataDir)` con `POS_DATA_DIR` no persistente (contenedor sin volumen) → cada reinicio invalida todos los tokens de 8 h de los cajeros.
**Recomendación:** permitir `JWT_SECRET` por variable de entorno en el servidor; documentar que `POS_DATA_DIR` debe ser un volumen persistente.

### M11 — Listados sin límite superior salvo `listSales`
`listCreditAccounts` (`cuentas.ts:61`), `listCustomers` (`clientes.ts:10`), `listProducts`/`listActiveProducts`, `listSessions` (`caja.ts:151`): sin `limit`. Sólo `listSales` pagina (`MAX_PAGE_SIZE=100`). Con años de historial de fiado o de cortes, respuestas y memoria crecen sin cota.
**Recomendación:** paginar cuentas y cortes; limitar por defecto y aceptar rango de fechas obligatorio en históricos.

### M12 — `printer_interface` (ADMIN) pasa sin filtrar a `node-thermal-printer`
`src/main/services/printer.ts:57-70` + `config` editable por ADMIN. Acepta `tcp://host:port`; en el servidor standalone permite a un ADMIN provocar conexiones salientes a hosts/puertos internos (SSRF / escaneo) vía `isPrinterConnected()` / `execute()`.
**Recomendación:** validar el formato de la interfaz (allowlist de esquemas, rango de IP de la LAN) o restringir a `printer:` / dispositivos locales.

---

## BAJO

- **B1** `salesQuerySchema.paymentMethod` (`src/main/routes/ventas.ts:18`) es `['CASH','CARD','TRANSFER']`: el admin no puede filtrar ventas a crédito en el historial, aunque `listSales` sí las devuelve.
- **B2** El ticket impreso real usa `${item.quantity}x` (`src/main/services/printer.ts:92`) mientras `buildTicketLines` ya usa `fmtQty` (línea 39). Para productos KG el papel muestra `0.5x` en vez de `500g`. Inconsistencia entre la vista testeable y la impresión real.
- **B3** Producto con `price = 0` (permitido por `productSchema.price.nonnegative()`, `src/main/routes/productos.ts:25`) se puede vender gratis: `createSale` no exige precio de línea mínimo.
- **B4** `/api/ping` y `/api/licencia/estado` sin auth: exponen versión, `engine`, `phase` y (estado de licencia) el fingerprint de hardware. Info disclosure menor.
- **B5** `originalPrice: price === product.price ? null : product.price` (`src/main/services/ventas.ts:89`): comparación de igualdad de floats; borde inofensivo pero frágil.
- **B6** `addAbono` y `POST /api/cuentas/:id/abono` responden `201` para lo que es una actualización de una cuenta existente (debería ser `200`). Igual criterio discutible en otros PUT/DELETE.
- **B7** `request.ip` sin `trustProxy` en `buildServer`: tras un reverse proxy, el throttle de licencia agrupa a todos los clientes en un bucket y los logs registran la IP del proxy.
- **B8** `failedAttempts` (`src/main/routes/license.ts:17`) nunca purga entradas de IPs que fallan una vez y no vuelven — fuga de memoria pequeña y acotada por el espacio de IPs de la LAN.
- **B9** `deactivateCategory` (`src/main/services/categorias.ts:69-73`) no reasigna ni avisa de los productos que quedan apuntando a una categoría inactiva; `listActiveProducts` los sigue mostrando con `categoryName` de una categoría dada de baja.
- **B10** `SaleListItem.itemCount` (dashboard y `listSales`) es `sum(quantity)`, que para líneas KG incluye kilos fraccionarios: el nombre "itemCount" engaña (no es número de artículos). El tipo (`number`) es consistente con `src/shared/types.ts`.

---

## Consistencia de contratos (`src/shared/types.ts`)

Tras el diff, `Sale.customerId`, `SaleItem.originalPrice`, `SaleItem.unit`, `Product.unit`, `SaleWithItems.customerName`, `SaleListItem.customerName` y `CartLineInput.price` están alineados con los servicios y el schema. No se detectaron divergencias de forma; la observación B10 es semántica, no de tipo.

---

## Diferencias Electron vs. servidor standalone

| Aspecto | Electron (`src/main/index.ts`) | Standalone (`src/server`) |
|---|---|---|
| Bind | `127.0.0.1` | `0.0.0.0` (LAN) |
| CORS | orígenes restringidos en prod (`['app://.','file://']`) | `true` (abierto) si `POS_ALLOWED_ORIGINS` sin definir — **M1** |
| Auth de Socket.io | irrelevante (una máquina) | ausente — **A4** |
| Motor / tx | SQLite (`withTx` emulado) | PG nativo si `DATABASE_URL`; SQLite emulado si no — **M3** |
| Backup al cerrar caja | copia del archivo SQLite (`services/backup.ts`) | `{ skipped: 'postgres' }` — depende de `pg_dump` en cron **externo**, la app no lo verifica ni lo ejecuta |
| `jwt_secret` | persistente en `paths.dataDir` | depende de que `POS_DATA_DIR` sea volumen persistente — **M10** |
| Credenciales seed | riesgo bajo (localhost) | **C1** (expuesto en LAN) |
| Licencia / `VENDOR_SECRET` | inyectado en build por `electron.vite.config.ts` | por entorno; fallback silencioso — **M7** |

Nota: el backup en Fase 2 (PostgreSQL) queda enteramente fuera de la aplicación. No hay verificación de que el `pg_dump` en cron exista o funcione; conviene un endpoint/health-check de "último backup correcto".
