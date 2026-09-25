# Auditoría de Base de Datos — pos-desktop (READ-ONLY)

Fecha: 2026-09-09 · Rama: main · Alcance: capa de datos Drizzle doble motor (SQLite / PostgreSQL)

Motor: SQLite (better-sqlite3) Fase 1 single-node · PostgreSQL (pg) / PGlite Fase 2 multicajero.
Esquemas: `src/main/db/schema.sqlite.ts`, `schema.pg.ts`, barril `schema.ts`, `index.ts`, `tx.ts`, `seed.ts`.
Migraciones: `resources/migrations` (SQLite, 0000–0004) · `resources/migrations-pg` (PG, 0000–0003).

---

## CRÍTICO

### C-1. `scripts/sqlite-to-postgres.ts` omite columnas → corrupción silenciosa en la migración a Fase 2
`scripts/sqlite-to-postgres.ts:33-110`. Las listas de columnas de `TABLES` están desactualizadas respecto al esquema PG ya migrado (migraciones-pg 0001/0002/0003):

- `products` (línea 37-48): **falta `unit`**. Tras 0002 la columna es `text NOT NULL DEFAULT 'PIEZA'`. El INSERT no la envía → todos los productos vendidos por KG quedan como `PIEZA`.
- `sale_items` (línea 78-81): **faltan `original_price` y `unit`**. `original_price` (nullable) se pierde → se borra el rastro de descuentos aplicados por el cajero. `unit` toma el default `PIEZA` → todas las líneas históricas de venta por peso quedan mal etiquetadas mientras `quantity` sigue en kg (decimales). Reportes de "producto top" y reimpresión de tickets quedan inconsistentes.
- `sales` (línea 64-77): **falta `customer_id`**. Se pierde el vínculo cliente↔venta de las ventas a crédito y de las ventas nominativas de contado.

El INSERT usa lista de columnas explícita + `OVERRIDING SYSTEM VALUE`, así que las columnas ausentes toman default/NULL **sin error**: la migración "termina con ✅" pero deja datos corruptos.
Recomendación: derivar las listas de columnas del esquema Drizzle (o de `information_schema`) en vez de hardcodearlas; añadir una verificación post-migración que compare `COUNT(*)` y sumas de control (`sum(total)`, `sum(subtotal)`, nº de KG) entre origen y destino; abortar si difieren.

### C-2. Ausencia total de índices secundarios
Ni SQLite ni PG declaran un solo índice no-único (`grep` sobre `schema.*.ts` y ambas carpetas de migración: sólo `users_username_unique` y `categories_name_unique`). PostgreSQL **no** crea índice automático para las claves foráneas. Consecuencias:

- `sales.created_at` — filtrado en TODOS los reportes (`services/reportes.ts:99,171`, `services/dashboard.ts:14`, `services/ventas.ts:181-182`) → *seq scan* completo de `sales` en cada consulta.
- `sale_items.sale_id` — subconsulta correlacionada de `itemCount` por fila en `listSales` (`services/ventas.ts:204`), `dashboard.ts:54`, `reportes.ts:167` y join en `reportes.ts:127` → *seq scan* de `sale_items` por cada venta listada (N+1 a nivel de plan).
- `sales.cash_session_id` — `totalsFor` (`services/caja.ts:66`) y cálculo de `max(ticket_number)` (`services/ventas.ts:118-121`) en cada venta.
- `credit_accounts.status` / `.customer_id` / `.sale_id`, `credit_payments.cash_session_id` / `.credit_account_id`, todas las FK de `sales` y `cash_sessions`.

En SQLite single-node con pocos miles de filas es tolerable; en PG multicajero con años de historial degrada de forma no lineal y agrava el bloqueo por escritura.
Recomendación: nueva migración (en ambos juegos) con índices: `sales(created_at)`, `sales(cash_session_id)`, `sales(customer_id)`, `sales(payment_method)`, `sale_items(sale_id)`, `sale_items(product_id)`, `credit_accounts(status)`, `credit_accounts(customer_id)`, `credit_accounts(sale_id)`, `credit_payments(credit_account_id)`, `credit_payments(cash_session_id)`, `cash_sessions(user_id)`, `cash_sessions(status)`.

---

## ALTO

### A-1. Numeración de folio (`ticket_number`) con condición de carrera en PostgreSQL
`services/ventas.ts:118-136`. El folio se calcula `select coalesce(max(ticket_number),0)+1` y luego se inserta, dentro de una transacción pero **sin `SELECT ... FOR UPDATE` ni constraint única**. `grep "FOR UPDATE"` → 0 resultados en todo el repo. Con el aislamiento por defecto de PG (READ COMMITTED), dos ventas concurrentes en la misma sesión de caja leen el mismo `max` → folios duplicados. También existe `sale_items` insertado en bucle (ver M-4).
Mitigación actual: normalmente un cajero = una sesión abierta y una UI, pero la API `POST /api/ventas` (`routes/ventas.ts:44`) no impide peticiones concurrentes.
Recomendación: constraint `UNIQUE(cash_session_id, ticket_number)` + reintento ante violación, o bloquear la fila de `cash_sessions` con `FOR UPDATE` al inicio de la transacción, o un contador dedicado por sesión incrementado con `UPDATE ... RETURNING`.

### A-2. Dinero almacenado como coma flotante (`real` / `double precision`)
`schema.sqlite.ts` (`price`, `total`, `subtotal`, `amount_paid`, `change`, `opening/closing/expected/difference`, `paid`, `amount`) y su espejo `schema.pg.ts` usan `real` / `doublePrecision`. El propio comentario del esquema lo reconoce ("coma flotante de doble precisión"). Problemas:

- `sum()` en SQL sobre columnas float acumula error de redondeo (`services/caja.ts:57-64`, `dashboard.ts:19-22`, `cuentas.ts:180`, `reportes.ts:123-124`); el `round2` en JS llega *después* de la suma.
- Comparaciones de igualdad frágiles: `settled = paid >= account.total` (`services/cuentas.ts:162`), `input.amountPaid < total` (`ventas.ts:100`). Cada valor guardado se redondea con `round2`, lo que reduce el riesgo pero no lo elimina (0.1 + 0.2, sumas largas).
- `sale_items.quantity` KG en float: `round3` mitiga pero `subtotal = round2(price * quantity)` hereda el error.

Recomendación: migrar a enteros en centavos (`integer`/`bigint`) para importes y a `integer` en gramos/miligramos para cantidades KG, o `numeric(12,2)` en PG con un tipo equivalente serializado en SQLite. Es un cambio grande; como mínimo, mover todos los `round2` al borde de entrada y hacer las sumas en JS sobre valores ya redondeados, no en SQL.

### A-3. Migraciones nuevas sin commitear → riesgo de despliegue inconsistente
`resources/migrations/0002-0004`, `resources/migrations-pg/0001-0003` y los cambios de `meta/_journal.json` están **sin seguimiento / sin commit** (git status). El código de negocio ya asume `products.unit`, `sale_items.unit`, `sale_items.original_price`, `sales.customer_id`. `src/main/db/index.ts:96-108` aplica sólo las migraciones presentes en disco; si se empaqueta/despliega sin estos archivos, `initDb` deja la BD en el esquema viejo y el runtime falla al leer/insertar esas columnas.
Recomendación: commitear los seis archivos SQL + ambos `_journal.json` + los `meta/*_snapshot.json` juntos, en un solo commit, antes de cualquier build. Verificar que `electron-builder` los incluye como `extraResources` y que el build del servidor standalone copia `resources/migrations-pg`.

---

## MEDIO

### M-1. `addAbono` — *lost update* sobre `credit_accounts.paid` en PG concurrente
`services/cuentas.ts:137-171`. Dentro de la transacción lee `account.paid`, calcula `paid = round2(account.paid + amount)` y hace `UPDATE`. Sin `FOR UPDATE` sobre la fila de la cuenta, dos abonos concurrentes a la misma cuenta (dos cobradores) leen `paid` idéntico y el segundo `UPDATE` pisa al primero: se pierde un abono y `status`/`closedAt` quedan mal. La validación `amount > balance` también usa el valor obsoleto.
Recomendación: `SELECT ... FROM credit_accounts WHERE id = ? FOR UPDATE` al entrar en la transacción; o `UPDATE credit_accounts SET paid = paid + ? ... RETURNING` y recalcular `status` a partir del valor devuelto.

### M-2. Comprobaciones "check-then-insert" no atómicas
- `openSession` (`services/caja.ts:23-39`): `getActiveSession` y luego `insert`, sin bloqueo. En PG dos peticiones del mismo usuario → dos sesiones `OPEN`. No hay índice único parcial `WHERE status='OPEN'`.
- `createSale` (`services/ventas.ts:30`): `getActiveSession` se ejecuta **fuera** de `withTx`; la sesión podría cerrarse entre la comprobación y el `insert`.
- `addAbono` (`services/cuentas.ts:134`): igual, `getActiveSession` fuera de la transacción.

Recomendación: índice único parcial `cash_sessions(user_id) WHERE status='OPEN'` en PG (y `CREATE UNIQUE INDEX ... WHERE` en SQLite, que lo soporta); mover las lecturas de sesión dentro de la transacción.

### M-3. Sin `CHECK` constraints en columnas tipo-enum
`role`, `status` (x3 tablas), `payment_method` (x2), `unit` (x2) son `text` sin `CHECK`. Drizzle sólo valida en TypeScript. Cualquier `$executeRaw`, el script de migración o un cliente SQL directo puede insertar valores inválidos. `active` es `integer` sin `CHECK (active IN (0,1))`.
Recomendación: añadir `CHECK` en una migración para ambos motores; refuerza además la integridad de la migración SQLite→PG.

### M-4. `PRAGMA foreign_keys=OFF` dentro de la transacción del migrador (SQLite 0003)
`resources/migrations/0003_wonderful_gabe_jones.sql:1`. El migrador de Drizzle ejecuta cada migración dentro de una transacción, y en SQLite `PRAGMA foreign_keys` es **no-op dentro de una transacción**. El `DROP TABLE sale_items` + `RENAME` funciona hoy sólo porque `sale_items` es tabla hoja (nadie la referencia). El patrón es frágil: si en el futuro algo referencia `sale_items`, la migración fallará de forma no evidente. Además conviene verificar que `foreign_keys` queda en `ON` tras migrar (se re-fija por conexión en `db/index.ts:76`, así que ok en runtime).

### M-5. Inserción de `sale_items` en bucle (N+1 de escritura)
`services/ventas.ts:139-145`: un `INSERT ... RETURNING` por línea. Una venta de 20 productos = 20 round-trips dentro de la transacción, alargando la ventana de bloqueo (crítico en PG multicajero). Igual patrón de lectura N+1 en `getCreditAccountDetail` → `getSaleWithItems` (3 queries extra por cuenta).
Recomendación: un único `insert(saleItems).values([...]).returning()`.

### M-6. `buildReport` carga todas las ventas del período en memoria
`services/reportes.ts:101-104` trae todas las filas de `sales` del rango para construir los *buckets* en JS. Un reporte mensual de una tienda activa son miles de filas (aceptable); un reporte anual o multi-año escala mal. Sin índice en `created_at` (C-2) además hace *seq scan*.
Recomendación: agregación en SQL (`GROUP BY` por hora/día con `date_trunc` en PG / `strftime` en SQLite) — pero eso rompe la portabilidad del dialecto; alternativa: mantener JS pero paginar/streamear y exigir el índice.

---

## BAJO

### B-1. `round2` con el truco `+ Number.EPSILON`
`src/main/lib/money.ts:2-3`. `Math.round((n + Number.EPSILON) * 100) / 100`: `Number.EPSILON` (~2.2e-16) es absoluto y se suma antes de multiplicar; para valores > ~1 es insuficiente para corregir el error de representación y para negativos (`difference`, `change`) el sesgo va en la dirección equivocada en el punto medio. Funciona en la práctica para importes pequeños pero no es robusto. Ligado a A-2.

### B-2. Sin estrategia de reversibilidad
Drizzle no genera *down migrations*. La 0003 de SQLite es una reconstrucción de tabla (preserva datos) pero no hay plan de rollback documentado ni backup automático previo a migrar en `initDb` (`db/index.ts:96`). Para Fase 2, un fallo a mitad de `migrate()` en PG deja el esquema a medias.
Recomendación: `pg_dump` / copia del `.db` automática antes de `migrateFor`; documentar el procedimiento de rollback.

### B-3. `license` sin unicidad
`schema.*.ts` tabla `license`: nada impide varias filas `status='ACTIVE'` para distintos/iguales `fingerprint`. `services/license.ts` debería garantizar una sola; conviene una constraint.

### B-4. `openCreditAccount` es código muerto / validación divergente
`services/cuentas.ts:35-59` valida cliente activo y hace `round2`, pero `createSale` (`ventas.ts:149-160`) inserta en `credit_accounts` directamente sin llamarla. Riesgo de divergencia futura. La validación de cliente activo en `createSale` ocurre fuera de la transacción (`ventas.ts:41-51`).

### B-5. Redondeo incremental de `total` depende del orden de líneas
`services/ventas.ts:83-84`: `total = round2(total + subtotal)` acumulando. Con floats el resultado puede variar ±0.01 según el orden de los ítems. Menor; se resuelve con A-2.

---

## INFORMATIVO

- **No existe control de inventario/stock**: no hay columna `stock`/`existencia` en `products` ni tabla de movimientos (`grep` sin resultados). La pregunta del brief sobre "race conditions en stock" no aplica hoy. Si se añade en Fase 2, el decremento de stock deberá ir dentro de la transacción de venta con `SELECT ... FOR UPDATE` sobre la fila del producto (o `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ? RETURNING`), o habrá sobreventa con multicajero.
- **Paridad de esquemas SQLite↔PG: buena en el estado actual.** Mapeos consistentes: `real`↔`double precision` (ambos float8), timestamps `integer` epoch UTC en ambos (`unixepoch()` vs `extract(epoch from now())::int`), booleanos como `integer` 0/1 en ambos, enums como `text` en ambos, `autoIncrement`↔`GENERATED ALWAYS AS IDENTITY`. La divergencia real no está en los dos archivos de esquema sino en (a) el script de migración C-1 y (b) que ambos esquemas se mantienen sincronizados **a mano** y se regeneran con dos comandos distintos (`db:generate` / `db:generate:pg`) — riesgo de proceso, no de código.
- **`_journal.json`**: el `version` de cabecera (`"7"`) distinto del `version` por entrada (`"6"` en SQLite) es normal en Drizzle (formato de journal vs formato de snapshot). No es un problema.
- **`OVERRIDING SYSTEM VALUE` + `setval(...)`** en `sqlite-to-postgres.ts:158,177-183`: la conservación de IDs y el reajuste de secuencias es **correcto** (el tercer argumento `is_called` se maneja bien tanto con filas como sin ellas). El único defecto del script es C-1.
- **PGlite** se usa en `verify:backend:pg` y `server:dev` (`package.json`): es monoconexión, no reproduce concurrencia real → las carreras A-1/M-1/M-2 no se detectarán en esas pruebas. Conviene un test de carga contra PostgreSQL real antes de Fase 2.
- **`withTx`** (`src/main/db/tx.ts`): la emulación SQLite con `BEGIN`/`COMMIT`/`ROLLBACK` es segura por ser el driver síncrono; en PG delega en la transacción nativa de Drizzle. No se usan savepoints. Correcto. Nota: el `BEGIN` de SQLite es `DEFERRED`; bajo contención el segundo escritor espera hasta `busy_timeout=5000ms` y luego lanza `SQLITE_BUSY` — aceptable en single-node (un solo proceso Electron serializa por el API síncrono de better-sqlite3).

---

## Resumen de prioridades

| # | Sev | Archivo:línea | Tema |
|---|-----|---------------|------|
| C-1 | Crítico | scripts/sqlite-to-postgres.ts:37,64,78 | Migración PG omite `unit`(x2), `customer_id`, `original_price` → corrupción silenciosa |
| C-2 | Crítico | schema.*.ts / migraciones (todas) | Cero índices secundarios; FK sin índice en PG |
| A-1 | Alto | services/ventas.ts:118-136 | Folio `ticket_number` con carrera en PG (sin UNIQUE / FOR UPDATE) |
| A-2 | Alto | schema.*.ts (columnas dinero) + lib/money.ts | Dinero en float; sum() en SQL antes de redondear |
| A-3 | Alto | resources/migrations*(sin commit) | Migraciones nuevas sin commitear → despliegue inconsistente |
| M-1 | Medio | services/cuentas.ts:137-171 | `credit_accounts.paid` lost-update en PG |
| M-2 | Medio | services/caja.ts:23-39; ventas.ts:30 | check-then-insert no atómico (sesión de caja, venta) |
| M-3 | Medio | schema.*.ts (role/status/payment_method/unit/active) | Sin CHECK constraints |
| M-4 | Medio | resources/migrations/0003_*.sql:1 | `PRAGMA foreign_keys=OFF` no-op dentro de la transacción del migrador |
| M-5 | Medio | services/ventas.ts:139-145 | Inserción de `sale_items` en bucle (ventana de bloqueo) |
| M-6 | Medio | services/reportes.ts:101 | Reporte carga todo el período en memoria |
| B-1..B-5 | Bajo | money.ts / db/index.ts / license / cuentas.ts | Redondeo frágil, sin rollback, license sin unicidad, código muerto |
