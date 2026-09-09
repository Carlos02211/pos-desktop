# Auditoría Frontend (renderer Electron) — POS desktop

Alcance: `src/renderer/src` + contraste con `src/main`. Modo read-only. Diff sin commitear
(feature "precio editable por línea" + "productos por KG" + refactor de cliente en CobroModal
+ eliminación de ClienteFormModal).

Leyenda: Crítico / Alto / Medio / Bajo.

---

## CRÍTICO

### C1. El renderer es ahora autoritativo sobre el precio de cada línea (regresión del invariante)
`src/renderer/src/components/CobroModal.tsx:105`
```
items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price }))
```
El cliente **siempre** envía `price`. En `src/main/services/ventas.ts:76-82` el servidor usa el
precio del cliente cuando `line.price != null` (que siempre lo es):
```
let price = product.price
if (line.price != null) { ...; price = round2(line.price) }
```
Consecuencias:
1. Se rompe el invariante documentado explícitamente en `src/shared/types.ts` (comentario viejo:
   "El precio SIEMPRE lo pone el servidor"). Un renderer modificado/comprometido puede fijar
   cualquier precio dentro de `0 < p <= 1_000_000` (zod en `src/main/routes/ventas.ts:31`).
2. **Precio obsoleto**: `cart.store.ts:addItem` congela `price`/`originalPrice` del catálogo en el
   momento de agregar. Si el admin cambia el precio (evento `producto:update`) mientras el ítem ya
   está en el carrito y el cajero NO lo tocó, el cliente manda el precio viejo; el servidor lo
   acepta y además, como `price !== product.price`, registra `originalPrice = precio nuevo`
   (`ventas.ts:89`), etiquetando la venta como "precio editado" **falsamente** y cobrando el
   importe equivocado.

Recomendación: enviar `price` **solo cuando la línea fue editada**:
`price: i.price !== i.originalPrice ? i.price : undefined`. Así el servidor vuelve a ser la fuente
de verdad del precio de catálogo y `originalPrice` solo se marca en ediciones reales. Idealmente
el backend debería además validar el precio editado contra un rango relativo al de catálogo
(p. ej. no permitir > precio de catálogo, o exigir PIN/rol para descuentos) — delegar a `security`.

---

## ALTO

### A1. Sin idempotencia en el registro de venta → riesgo de venta/ticket duplicado
`src/renderer/src/components/CobroModal.tsx:98-118`, `src/renderer/src/api/ventas.ts`
`crearVenta` no envía token de idempotencia. Si el POST se registra en el servidor pero la
respuesta se pierde (timeout de red, típico en Fase 2 multicajero), el `catch` pone
`submitting=false` y muestra error; el cajero reintenta y se genera **una segunda venta con su
propio `ticketNumber`** y, si es CREDIT, una segunda cuenta por cobrar.
Recomendación: generar un `clientRequestId` (uuid) por intento de cobro, enviarlo en el body/header
y que el backend deduplique (delegar la parte server a `backend`). En el cliente, mantener el mismo
id mientras el modal siga abierto y no cambie el carrito.

### A2. `CobroModal` puede cerrarse durante el submit (Escape / clic fuera)
`src/renderer/src/components/Modal.tsx:16-28`, `CobroModal.tsx:98`
`Modal` cierra con Escape y con clic en el overlay sin condición. Si el cajero cierra tras pulsar
"Confirmar venta", `confirm()` sigue en vuelo: si tiene éxito llama `onDone` sobre un componente
desmontado (warnings de setState) y, sobre todo, el cajero cree que canceló y vuelve a cobrar
(agrava A1). 
Recomendación: aceptar un prop `closable`/`busy` en `Modal` y bloquear Escape + overlay + botón X
mientras `submitting || creatingCustomer`.

---

## MEDIO

### M1. Creación duplicada de cliente al reintentar un fiado
`src/renderer/src/components/CobroModal.tsx:82-96`
`ensureCustomer` crea el cliente con `crearCliente`, pero **no añade el resultado a `customers`**
ni recarga la lista. Si `crearVenta` falla después, al reintentar `ensureCustomer` no encuentra el
nombre en `customers` (`find` por nombre, línea 87) y **crea otro cliente** con el mismo nombre.
Recomendación: tras `crearCliente`, `setCustomers((cs) => [...cs, created])` y guardar el id en
`clienteId`.

### M2. La pantalla del cobrador no muestra estado de conexión; eventos perdidos = catálogo obsoleto
`src/renderer/src/pages/cobrador/CobradorLayout.tsx`, `SessionBar.tsx`, `stores/socket.store.ts`
El indicador `connected` solo se pinta en el Dashboard admin (`pages/admin/Dashboard.tsx:33`). En
`PanelVenta` la única actualización de catálogo es el evento `producto:update`
(`PanelVenta.tsx:56-64`); si el socket se cae, no hay reintento ni aviso y el cajero sigue
vendiendo con precios/productos viejos (ver C1.2). En Fase 2 (multicajero por red) esto es
esperable, no excepcional.
Recomendación: mostrar el estado de conexión en `SessionBar`; al reconectar (`socket.on('connect')`)
forzar `loadCatalog()` en `PanelVenta`; opcionalmente refetch periódico del catálogo.

### M3. `ProductoFormModal`: fuga de blob URLs
`src/renderer/src/components/admin/ProductoFormModal.tsx:32-36`
```
const preview = file ? URL.createObjectURL(file) : ...
```
Se llama en **cada render** (cada tecla en nombre/precio) y nunca se hace `URL.revokeObjectURL`.
Recomendación: `useMemo(() => file && URL.createObjectURL(file), [file])` + cleanup en `useEffect`.

### M4. `PanelVenta` re-renderiza toda la grilla de productos en cada mutación del carrito
`src/renderer/src/pages/cobrador/PanelVenta.tsx:25`
```
const { items, addItem, setQty, setPrice, removeItem, clear } = useCartStore()
```
Sin selector: cualquier cambio del store re-renderiza `PanelVenta` y con él los N `ProductoBtn`
(`ProductoBtn` no está memoizado). Con catálogos de cientos de productos, cada edición de gramos /
precio / +/- repinta toda la grilla.
Recomendación: selectores puntuales (`useCartStore((s) => s.items)`, acciones por separado o
`useShallow`) y envolver `ProductoBtn` en `React.memo`. La lista de productos no está virtualizada;
para catálogos muy grandes considerar `@tanstack/react-virtual`.

### M5. Accesibilidad — modales sin `role="dialog"` / foco
`src/renderer/src/components/Modal.tsx`
No hay `role="dialog"`, `aria-modal="true"`, focus trap, ni restauración de foco al cerrar. En un
POS operado con teclado el foco puede "escapar" detrás del overlay. `<h2>` no está asociado al
diálogo (`aria-labelledby`).
Recomendación: añadir atributos ARIA, mover foco al contenedor al montar, restaurarlo al
desmontar, y trap de Tab (o `inert` en el fondo).

### M6. Accesibilidad — autocompletar de cliente no navegable por teclado
`src/renderer/src/components/CobroModal.tsx:146-196`
Las sugerencias se seleccionan con `onMouseDown` únicamente; no hay flechas arriba/abajo, Enter,
`role="listbox"/"option"`, ni `aria-activedescendant`. El cierre depende de un
`setTimeout(120ms)` en `onBlur` (frágil). Un cajero que teclea el nombre y pulsa Enter no
selecciona la sugerencia: cae en "se creará como cliente nuevo" salvo coincidencia exacta.
Recomendación: patrón combobox accesible con navegación por teclado.

### M7. Producto por KG: un toque = +1 kg, sin señal visual
`src/renderer/src/stores/cart.store.ts:27-50`
`addItem` siempre incrementa `quantity + 1`. Para un producto KG eso son +1 kg por toque; un doble
toque accidental deja 2 kg silenciosamente. `ProductoBtn` no distingue la interacción para KG.
Recomendación: para `unit === 'KG'`, al agregar por primera vez fijar una cantidad neutra
(p. ej. abrir el editor de gramos enfocado) en lugar de acumular toques; o mostrar aviso.

### M8. `CarritoItem` KG: el input acepta valores no válidos
`src/renderer/src/components/CarritoItem.tsx:51-58, 116-128`
`commitGrams` solo valida `Number.isFinite(value) && value > 0`; no exige entero. `"1.5"` g →
`0.0015` kg → `round3` → `0.002` kg (2 g). `<input step="1">` no lo impide (solo afecta a las
flechas). Además `commitPrice`/`commitGrams` usan `Number(draft)` sin `.replace(',', '.')`, a
diferencia de `ProductoFormModal` (`:29`) — inconsistencia con teclados de locale con coma decimal.

---

## BAJO

### B1. `lib/format.ts` vs backend: formato de dinero y cantidad divergen
- `money()` (`format.ts:2`) fija `$` y `toFixed(2)`, sin separador de miles ni locale; el símbolo
  configurable sigue siendo TODO ("Sprint 7"). El backend (`printer.ts:14`) tiene su propia
  `fmt`. `src/main/lib/money.ts` solo redondea (`round2`/`round3`), no formatea — el redondeo del
  cliente (`Math.round((n+EPSILON)*100)/100` en `cart.store.ts:74`, `CarritoItem.tsx:37`,
  `CobroModal.tsx:72`) coincide con `round2` del backend. OK en redondeo; divergente en formato.
- `formatQty` (`format.ts:7-11`) elimina ceros a la derecha (`"1.5 kg"`); el ticket
  (`printer.ts:20`) imprime `toFixed(3)` (`"1.500kg"`). Cosmético, pero el detalle en pantalla no
  coincide con el papel.
Recomendación: una sola utilidad de formato compartida en `src/shared`.

### B2. Tipos: unión literal repetida en vez de `ProductUnit`
`format.ts:7`, `CarritoItem` (vía `CartItem`), `ProductoFormModal.tsx:21,84`,
`stores/cart.store.ts` (bien: usa `ProductUnit`). `formatQty` y `ProductoFormModal` declaran
`'PIEZA' | 'KG'` a mano; deberían importar `ProductUnit` de `@shared/types` para no divergir si se
añade una tercera unidad.

### B3. `setPrice` del store hace no-op silencioso
`src/renderer/src/stores/cart.store.ts:60-63` — si `price <= 0` no cambia nada y no informa.
`CarritoItem.commitPrice` ya valida y restaura el draft, así que la guarda del store es defensiva
duplicada; aceptable, pero conviene un único punto de validación.

### B4. `Product`/`ProductWithCategory` con `unit` nuevo — datos viejos
Migración `schema.sqlite.ts:40-42` pone `default('PIEZA') NOT NULL`, así que el backend siempre
devuelve `unit`. Si por algún camino llegara `undefined`, `CarritoItem` (`isKg = unit === 'KG'`)
degrada a PIEZA de forma segura. Sin acción, solo se confirma que el fallback es correcto.

### B5. `ProductoBtn` imagen: `alt={product.name}` correcto; sin `width/height` → posible layout
shift al cargar imágenes del grid. Menor.

---

## Eliminación de `admin/ClienteFormModal.tsx` — verificación

- **Sin referencias rotas.** `grep -rn "ClienteFormModal|actualizarCliente|desactivarCliente"` sobre
  `src/` y `docs/` no devuelve nada. Los helpers `actualizarCliente` / `desactivarCliente` se
  quitaron limpiamente de `src/renderer/src/api/cuentas.ts`.
- **Función reemplazada parcialmente.** `pages/admin/Clientes.tsx` se reescribió a un directorio
  *solo-alta* (lista de nombres + "Agregar"). Ya no existe en el renderer forma de **renombrar,
  editar teléfono/notas ni desactivar** un cliente. Un nombre mal escrito creado desde `CobroModal`
  (que crea clientes al vuelo, `CobroModal.tsx:91`) queda sin vía de corrección en la UI.
  Verificar si el backend aún expone `PUT/DELETE /api/clientes/:id` (código muerto server-side) y si
  el `CustomerInput` conserva campos ya no usados por ningún formulario. → Producto/limpieza, no bug.

---

## Estado / persistencia del carrito

- `cart.store.ts` es 100 % en memoria (sin `persist`). Un reload/crash de Electron a mitad de venta
  pierde el carrito. Para un POS de mostrador es defendible; si se quiere robustez, `zustand/persist`
  con `sessionStorage` y limpieza al confirmar. (Bajo)
- No hay condición de carrera real cliente↔servidor en el total: el servidor recalcula todo
  (`ventas.ts:58-94`). El `total` que `PanelVenta` pasa a `CobroModal` y los `items` que el modal lee
  del store se mantienen vivos y consistentes.
- `CarritoItem` usa correctamente el patrón de React "ajustar estado en render cuando cambia una
  prop" (`:29-32, :46-49`) para resincronizar los drafts; sin `useEffect`, correcto.

## Seguridad cliente

- **Sin `dangerouslySetInnerHTML` ni `innerHTML`** en `src/renderer/src` (grep limpio).
- **Token JWT solo en memoria** (`stores/auth.store.ts`): sin `localStorage`/`sessionStorage` en
  todo el renderer (grep limpio salvo el comentario que lo documenta). Correcto.
- `client.ts` adjunta `Authorization: Bearer` solo si hay token; maneja 401 → `onUnauthorized`.
  Bien. `API_BASE_URL` en Fase 2 = `window.location.origin` (mismo origen), sin CORS abierto por el
  cliente.
- Imágenes de producto: `src={`${API_BASE_URL}/uploads/${product.imagePath}`}` con `imagePath` del
  servidor, interpolado como atributo (React escapa). Sin riesgo de XSS por atributo; el riesgo de
  path traversal queda del lado del server (delegar a `security`).
