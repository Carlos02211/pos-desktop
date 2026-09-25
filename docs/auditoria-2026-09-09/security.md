# Auditoría de seguridad — POS SpArTaN Tech (read-only)

Fecha: 2026-09-09 · Alcance: src/main (Fastify), src/server (standalone Fase 2), src/preload/renderer (Electron), licencias, deploy.

Leyenda de severidad: CRÍTICO / ALTO / MEDIO / BAJO / INFO.

---

## CRÍTICO

### C1. Credenciales por defecto conocidas en un servidor expuesto a la red
- Archivo: `src/main/db/seed.ts:31-45`
- El seed crea `admin/admin123` y `cajero/cajero123` en cada arranque si no hay usuarios. Estas credenciales están en el repositorio público.
- El servidor de Fase 2 (`src/server/config.ts:31`, `src/server/index.ts`) escucha en `0.0.0.0:3000` y corre el mismo `runSeed` (`src/server/index.ts:27`). No hay ninguna obligación de cambiar la contraseña en el primer login.
- Impacto: cualquier dispositivo de la LAN (tablet invitada, Wi-Fi comprometido) obtiene rol ADMIN completo: usuarios, ventas, reportes, configuración, exportaciones con datos de clientes.
- Root cause: contraseñas de bootstrap fijas + sin flujo de rotación forzada + bind en `0.0.0.0`.
- Remediación:
  - Generar contraseña aleatoria por instalación y mostrarla una sola vez en consola/instalador, o exigir cambio de contraseña en el primer login (flag `must_change_password`).
  - No sembrar el usuario `cajero` de prueba en producción (`isDev`).
  - Documentar y verificar el cambio antes de exponer el puerto.
- Rotación de credenciales: SÍ — cambiar admin/cajero en toda instalación ya desplegada.
- Verificación: `curl -s http://SERVIDOR:3000/api/auth/login -d '{"username":"admin","password":"admin123"}' -H 'content-type: application/json'` no debe devolver token.

---

## ALTO

### A1. Sin protección contra fuerza bruta / credential stuffing en el login
- Archivo: `src/main/routes/auth.ts:14-17`, `src/main/services/auth.ts:13-24`
- `/api/auth/login` no tiene rate limiting, ni lockout de cuenta, ni backoff progresivo (a diferencia de `routes/license.ts:15-32` que sí throttlea). Usuarios conocidos (`admin`, `cajero`).
- Impacto: adivinación offline-speed de contraseñas contra el servidor de red; combinado con C1 y contraseñas débiles de 6 caracteres (`usuarios.ts:29`).
- Remediación: throttle por IP + por cuenta (p. ej. 5/min y 20/h por username), retardo incremental, respuesta 429; considerar `@fastify/rate-limit`. Registrar intentos fallidos.
- Rotación: no, salvo que se detecte abuso.
- Verificación: 10 intentos fallidos seguidos deben empezar a devolver 429.

### A2. Socket.io sin autenticación ni autorización
- Archivo: `src/main/socket.ts:16-23` (`io.on('connection', …)` no valida nada), `src/main/socket.ts:33-35` (`_io.emit` global), emisiones en `routes/ventas.ts:46-60`, `routes/caja.ts:51-82`, `routes/cuentas.ts:53-58`.
- Cualquier cliente que abra un socket recibe TODOS los eventos de negocio: totales de venta, aperturas/cierres de caja con diferencias, IDs de cliente y saldos de cuentas por cobrar (`cuenta:abono`).
- En Fase 1 (Electron, `127.0.0.1`) el riesgo es bajo; en Fase 2 (`0.0.0.0:3000`) es exposición real a toda la LAN. El propio código lo reconoce como pendiente (`socket.ts:17`).
- Impacto: fuga de información financiera y de clientes a dispositivos no autenticados.
- Remediación: middleware `io.use()` que exija el JWT (`socket.handshake.auth.token`) y lo verifique con `verifyToken`; unir a salas por rol; no emitir cifras a salas de COBRADOR que no las necesiten.
- Verificación: `socket.io-client` sin token debe ser rechazado en el handshake.

### A3. Servidor de Fase 2 sirve API y login en HTTP plano sobre la LAN
- Archivo: `src/main/server.ts:120-129`, `src/server/config.ts:29-31`, `deploy/.env.example:6-7`
- No hay TLS ni redirección HTTPS; el login (`password` en claro) y el `Authorization: Bearer <JWT>` viajan sin cifrar por Wi-Fi.
- Impacto: sniffing pasivo / ARP spoofing en la red de la tienda → robo de credenciales y de tokens de 8 h reutilizables.
- Remediación: terminar TLS (reverse proxy local con certificado propio / mkcert, o `https` nativo de Node); marcar cookies/headers en consecuencia; documentar en el runbook de Fase 2.
- Verificación: `http://` debe redirigir o rechazar; `openssl s_client` contra el puerto de servicio.

### A4. "Vendor secret" de licencias filtrado en git y fallback inseguro silencioso
- Archivos: `deploy/.env.example:21` y `deploy/.env.example:23` (HEAD y árbol de trabajo), commit `62e0cc0` (`POS_VENDOR_SECRET=SPARTAN-TECH-VENDOR-SECRET-2026`), `src/main/services/license.ts:28-47`, `src/server/index.ts` (no valida el secreto).
- El valor `SPARTAN-TECH-VENDOR-SECRET-2026` quedó commiteado; está en `KNOWN_LEAKED_SECRETS` (bien), pero:
  - El servidor standalone NO corta el arranque si falta / es un valor filtrado — solo un `console.warn` y cae a `DEV_ONLY_SECRET`, que es público (`license.ts:28,41-47`). El comentario de `.env.example:23` afirma "el servidor no arranca" — es falso; `check-vendor-secret.ts` solo protege `build:win`, no `build:server` ni `src/server/index.ts`.
  - `GET /api/licencia/estado` es público y expone el `fingerprint` (`routes/license.ts:35`, `services/license.ts:128-132`). Con el secreto de dev/filtrado, cualquiera calcula la clave con `expectedKeyForFingerprint` y activa (`POST /api/licencia/activar`, también sin auth, y muta la tabla `license`).
- Impacto: bypass / falsificación de licencias; si algún `.exe` de cliente se compiló con el secreto filtrado, todas sus licencias son falsificables.
- Remediación:
  - Añadir a `src/server/index.ts` la misma validación de `check-vendor-secret.ts` y abortar si falta o es un valor conocido.
  - Rotar `POS_VENDOR_SECRET` (nuevo valor aleatorio) y reemitir claves; considerar reescribir historia o al menos invalidar el valor viejo permanentemente (ya hecho vía `KNOWN_LEAKED_SECRETS`).
  - Autenticar `/api/licencia/activar` (ADMIN) y no devolver el fingerprint sin auth, o al menos rate-limit y logging.
- Rotación: SÍ — `POS_VENDOR_SECRET`.
- Verificación: arrancar el servidor sin la variable debe fallar; `GET /api/licencia/estado` no debería ser anónimo o no debería revelar el fingerprint.

---

## MEDIO

### M1. CORS permisivo por defecto en el servidor standalone
- Archivo: `src/main/server.ts:67-70`, `src/main/socket.ts:12-14`, `src/server/config.ts:50-52`, `deploy/.env.example:16-18` (deja `POS_ALLOWED_ORIGINS` comentado → `allowedOrigins = true`).
- `origin: true` (refleja cualquier Origin) + `credentials: true`. La autenticación es por Bearer en memoria, así que el robo de token vía CORS es limitado, pero se exponen a cualquier web los endpoints anónimos (`/api/ping`, `/api/licencia/*`, handshake de socket.io) y se habilita fingerprinting de la red interna desde el navegador del cajero.
- Remediación: exigir `POS_ALLOWED_ORIGINS` explícito en producción; si está vacío, restringir a same-origin (no `true`). Nunca `origin:true` + `credentials:true`.
- Verificación: petición con `Origin: https://evil.example` no debe recibir `Access-Control-Allow-Origin` reflejado.

### M2. Sin cabeceras de seguridad en el servidor de Fase 2
- Archivo: `src/main/server.ts` (no se registra `@fastify/helmet` ni cabeceras manuales); la SPA se sirve desde `staticDir` (`server.ts:86-101`).
- Falta `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Strict-Transport-Security`, y no hay CSP para la SPA servida por HTTP (el `<meta>` CSP de `src/renderer/index.html` apunta a `localhost:3001`, no aplica bien en Fase 2).
- Impacto: clickjacking, sniffing de tipo MIME sobre `/uploads/`, y XSS sin mitigación de CSP en el contexto de red.
- Remediación: `@fastify/helmet` con CSP adecuada para la SPA (sin `unsafe-eval` en prod), `nosniff`, `frame-ancestors 'none'`.

### M3. CSP del renderer débil y duplicada
- Archivo: `src/renderer/index.html:10-18`
- `script-src 'self' 'unsafe-inline' 'unsafe-eval'` y `style-src 'unsafe-inline'`. `'unsafe-eval'`/`'unsafe-inline'` en scripts anulan gran parte del valor de la CSP frente a XSS.
- `connect-src` incluye `http://localhost:*` y `ws://localhost:*` (comodín de puerto).
- Remediación: build de producción sin `unsafe-eval`; nonce/hash para inline; fijar el puerto real; CSP específica por fase.

### M4. `jwt_secret` protegido en reposo con clave estática embebida
- Archivo: `src/main/lib/store.ts:29` (`ENCRYPTION_KEY = 'SPARTAN_TECH_2026_SECRET'`), `store.ts:54-62`.
- El `jwt_secret` (por instalación, aleatorio — bien) se guarda en `pos-config.json` cifrado con una clave fija que está en el binario y en el repo. Quien lea el archivo puede descifrar el secreto y falsificar JWT de esa instalación (incl. rol ADMIN).
- Impacto: en Fase 2 el archivo vive en `POS_DATA_DIR` del servidor; un acceso de lectura (backup mal permisado, recurso compartido) → forja de tokens.
- Remediación: derivar la clave de `electron.safeStorage` (Electron) o de una variable de entorno/secreto del SO en el servidor; permisos `600` en `pos-config.json` y en `POS_DATA_DIR`.

### M5. Verificación de JWT sin allowlist de algoritmo y sin revocación
- Archivo: `src/main/lib/jwt.ts:14-21`, `src/main/routes/auth.ts:21` (`logout` es no-op).
- `jwt.verify(token, secret)` sin `{ algorithms: ['HS256'] }`. Con `jsonwebtoken@9` y secreto string el riesgo de `alg:none`/confusión RS↔HS es bajo, pero debe fijarse explícitamente por defensa en profundidad.
- Token de 8 h sin lista de revocación: un token robado (ver A3) es válido hasta expirar aunque el usuario se desactive o cierre sesión.
- Remediación: `algorithms: ['HS256']`, `issuer`/`audience`; denylist de `jti` o versión de credenciales por usuario que invalide tokens al desactivar/cambiar contraseña; reducir expiración + refresh.

### M6. Subida de archivos: se confía en el `Content-Type` del cliente
- Archivo: `src/main/routes/productos.ts:74-86`, `src/main/routes/config.ts:39-51`
- La extensión se decide con `data.mimetype` (cabecera multipart controlada por el cliente); no hay validación de magic bytes. Nombre = `randomUUID` (bien, sin path traversal) y límite de 3 MB / 1 archivo (bien).
- Impacto: almacenamiento de un archivo con bytes arbitrarios bajo extensión `.png/.jpg/.webp`, servido desde `/uploads/` en el mismo origen que la SPA (Fase 2). `fastify-static` lo entrega con `Content-Type` por extensión, así que la ejecución como HTML/JS es poco probable, pero se puede alojar contenido (p. ej. para phishing) o un polyglot.
- Remediación: verificar firma real del archivo (magic bytes) y re-encodear la imagen (sharp) o al menos rechazar si el sniff no coincide; `X-Content-Type-Options: nosniff` en `/uploads/`; servir uploads desde un subdominio/origen separado en Fase 2.

### M7. Endpoints de licencia anónimos con efectos secundarios
- Archivo: `src/main/routes/license.ts:35-61`
- `GET /api/licencia/estado` (anónimo) revela el hardware fingerprint. `POST /api/licencia/activar` (anónimo) borra e inserta en la tabla `license` y persiste en `electron-store`. El throttle es solo por IP.
- Remediación: requerir ADMIN para activar; no exponer el fingerprint sin auth (o mostrarlo solo en la pantalla local de activación de Electron, no vía API de red).

### M8. Override de precio sin límite por COBRADOR
- Archivo: `src/main/services/ventas.ts:76-82`, schema `routes/ventas.ts:29`
- El cobrador puede fijar cualquier `price > 0` (hasta 1.000.000) por línea. Es una decisión de negocio (descuento a frecuentes) y queda traza en `originalPrice`, pero no hay piso, ni % máximo, ni aprobación.
- Remediación: límite de descuento configurable, o requerir PIN/ADMIN para precios por debajo de X%. Reporte de líneas con `originalPrice != null`.

---

## BAJO / INFO

### B1. Electron `sandbox: false`
- Archivo: `src/main/index.ts:42-45`. `contextIsolation` queda en su default (true) y `nodeIntegration` en false, así que el aislamiento principal se mantiene, pero el preload corre sin sandbox. El preload es mínimo (`src/preload/index.ts`). Recomendado `sandbox: true`.

### B2. Sin restricción de navegación en Electron
- Archivo: `src/main/index.ts:50-59`. Hay `setWindowOpenHandler` (deny + openExternal) pero no `will-navigate`/`will-attach-webview`. Un XSS en el renderer podría navegar a contenido remoto. Añadir handler `will-navigate` que bloquee orígenes externos.

### B3. Enumeración de usuarios por temporización (parcialmente mitigada)
- Archivo: `src/main/services/auth.ts:11,16`. `DUMMY_HASH` es un hash bcrypt malformado (salt inválido); `bcrypt.compare` puede retornar `false` sin consumir el mismo tiempo que un hash real → la mitigación anti-timing no es fiable. Usar un hash bcrypt válido real (rounds 12) generado una vez.

### B4. Transacciones SQLite sobre conexión compartida con huecos async
- Archivo: `src/main/db/tx.ts:19-38`. `withTx` en SQLite emite `BEGIN/COMMIT` sobre `db` global con `await fn(db)` en medio. Bajo concurrencia real (Fase 2 multicajero en SQLite) dos ventas simultáneas pueden entrelazar transacciones y corromper datos financieros. Integridad más que seguridad, pero relevante: forzar PostgreSQL en multicajero o serializar escrituras.

### B5. IDOR acotado en cuentas por cobrar
- Archivo: `src/main/routes/cuentas.ts:37-61`. Cualquier COBRADOR puede ver el detalle y registrar abonos de CUALQUIER cuenta (`:id` sin comprobación de pertenencia). Aceptable bajo el modelo de confianza actual (todos los cajeros de una tienda), pero conviene registrar `userId` del abono (ya se hace) y auditar.

### B6. `bcryptjs` trunca a 72 bytes
- Archivo: `src/main/services/usuarios.ts`, `db/seed.ts`. El schema permite contraseñas de 200 caracteres pero bcrypt ignora más allá de 72 bytes sin avisar. Informativo; documentar o pre-hashear con SHA-256.

### B7. Ejemplo con credenciales débiles de BD
- Archivo: `deploy/.env.example:10` (`postgres://pos:pos@localhost`). Es un ejemplo, pero se copia tal cual con frecuencia. Añadir nota de "cambiar antes de producción" y generar password.

### B8. Manejo de errores
- Archivo: `src/main/server.ts:103-112`. Correcto: 500 → mensaje genérico, log server-side. Los <500 devuelven `err.message` (mensajes de `HttpError`, controlados) y `details` de validación reflejan el input — aceptable, sin fuga de stack ni de entorno.

### B9. Dependencias
- `pnpm-lock.yaml`: `fastify@5.12.3`, `jsonwebtoken@9.0.3`, `socket.io@4.8.3`, `systeminformation@5.33.8` (post-parche CVE-2024-56334), `better-sqlite3@13.0.3`, `pg@8.23.0`, `electron@39.8.10`, `zod@4.5.4` — sin CVEs conocidos relevantes.
- `esbuild@0.18.20` presente como transitiva de dev (GHSA-67mh-4wv8-2f99, dev-server CORS) — solo build/dev, impacto bajo. Ejecutar `pnpm audit` en CI.

### B10. Logging
- Revisado `src/main/services` y `routes`: no se registran contraseñas, tokens, hashes ni cabeceras `Authorization`. El logger de Fastify por defecto no serializa headers. `console.log` del seed imprime las credenciales por defecto (`seed.ts:45`) — solo en primer arranque, pero queda en logs de pm2. Eliminar o degradar.

---

## Checklist rápido

| Área | Estado |
|---|---|
| Secretos en frontend | OK (token solo en memoria, `auth.store.ts`) |
| Secretos en git | FALLO — `POS_VENDOR_SECRET` en historia (A4) |
| Secretos en logs | Menor — credenciales de seed en consola (B10) |
| AuthN correcta | Parcial — sin rate limit/lockout (A1), creds por defecto (C1) |
| AuthZ server-side | OK — `requireRole` en cada ruta; ADMIN bypass intencional |
| Ownership checks | Parcial — cuentas por cobrar sin scoping (B5) |
| Rate limiting | FALLO en login (A1); OK en licencia |
| CORS | FALLO — `origin:true`+`credentials` por defecto (M1) |
| CSRF | OK de facto — Bearer en memoria, no cookies |
| XSS | Sin sinks (`dangerouslySetInnerHTML`/`eval`) en el código; CSP débil (M3) |
| SQL injection | OK — Drizzle parametrizado, sin SQL construido con input |
| SSRF | N/A — no hay fetch de URLs de usuario |
| Path traversal | OK — nombres `randomUUID`, sin paths de usuario |
| Uploads | Parcial — confía en Content-Type (M6) |
| Sesión/cookies | Tokens 8h sin revocación (M5) |
| TLS en producción | FALLO Fase 2 (A3) |
| Cabeceras de seguridad | FALLO Fase 2 (M2) |
| Electron isolation | OK (contextIsolation on, nodeIntegration off); `sandbox:false` (B1) |
| socket.io auth | FALLO (A2) |
| Backups | `services/backup.ts` — copia local sin cifrar; permisos de carpeta a revisar (M4) |
| Dependencias | OK (B9) |
