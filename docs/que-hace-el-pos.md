# Qué hace el POS SpArTaN Tech y para qué negocios sirve

Resumen para vender, cotizar e instalar. El detalle de uso está en
[`guia-de-uso.md`](guia-de-uso.md) (cobrador) y la instalación en
[`fase-2-instalacion-windows.md`](fase-2-instalacion-windows.md).

## Para qué negocios sirve

### ✅ Le queda perfecto — mostrador, venta rápida, caja y corte del día

| Giro                             | Lo que más usan                                                                |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Abarrotes / tiendita / minisúper | Lector de código de barras, catálogo de 7,000+ productos mexicanos, fiado      |
| Papelerías                       | **Varios** (precio libre) para copias, engargolados y tareas; cantidad escrita |
| Cremerías                        | Venta por kilo con botones de 100 g a 1 kg, fiado                              |
| Carnicerías                      | Venta por kilo, precio editable con tope de descuento                          |
| Fruterías / verdulerías          | Venta por kilo, **Varios** para lo que no tiene código                         |
| Tortillerías                     | Venta por kilo, cobro rápido, cortes por cajero                                |

### ✅ Pollerías, rosticerías y comida para llevar

| Giro                                            | Lo que más usan                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Pollos asados / rostizados                      | **Plantilla de pollería**, tipo de pollo, paquetes, encargos, envíos     |
| Antojitos, cocinas económicas, taquerías chicas | **Mesas** (cuentas abiertas), comanda para la cocina, notas por platillo |
| Comida para llevar con pedidos por teléfono     | **Encargos** con hora de entrega y anticipo                              |

### ✅ Con control de inventario

Ferreterías, farmacias pequeñas, tiendas de ropa, regalos y similares: existencia por
producto, entradas de mercancía, conteos, historial y aviso de lo que se está acabando.
(Sin lotes ni caducidades, y sin tallas/colores como variantes.)

### ❌ No es para

- **Restaurantes formales**: no tiene meseros con comandero en tableta, división de cuenta
  por persona, propinas ni pantalla de cocina. Las **mesas** sirven para negocios sencillos
  donde se cobra en caja.
- **Negocios que facturan seguido (CFDI)**: no timbra facturas.
- **Cadenas con varias sucursales** en un mismo sistema: es una sucursal con varias cajas.
- **Farmacias reguladas** (control de antibióticos, recetas, lotes).

## Qué hace

### En la caja

- Cobro tocando el producto o con **lector de código de barras**; buscador y categorías.
- Venta **por pieza** (cantidad escrita a mano) o **por kilo** (gramos, botones rápidos).
- **Varios / precio libre** (F2): importe y descripción para lo que no está en el catálogo.
- **Opciones por producto**: el cajero elige una de cada grupo (ej. pollo Natural, Adobado o
  Al carbón +$10; guarnición Arroz o Espagueti). El precio extra se suma solo.
- **Notas por producto** ("sin chile", "bien dorado"): salen en el ticket.
- Pagos en **efectivo** (cambio y billetes sugeridos), **tarjeta**, **transferencia** o
  **fiado** (con abono inicial).
- **Descuentos controlados** (tope por cajero) y **agregar productos olvidados** a una
  venta ya cobrada con el mismo folio.
- **Ticket de 80 mm**, reimpresión, ticket en PDF y **cajón de dinero**.
- **Retiros e ingresos de efectivo**, **apertura y cierre de caja** con diferencia.

### Encargos y mesas

- **Encargos**: pedido a nombre de alguien con día y hora de entrega, teléfono y nota
  (dirección a domicilio). **Anticipo** opcional que se cobra en ese momento; al entregarlo
  se cobra sólo lo que resta. Lista con los atrasados en rojo y los próximos en amarillo.
  Cancelar devuelve el anticipo como retiro de caja.
- **Mesas / cuentas abiertas**: "Mesa 3", "Don Pepe"… se les va agregando lo que piden
  (desde cualquier caja) y se cobra al final. **Comanda** para la cocina (sin precios) y
  **pre-cuenta** impresa. Si otra caja agrega algo mientras se cobra, el sistema lo detecta
  y no se pierde.
- **Envío a domicilio** como producto de precio libre.

### Productos e inventario

- Categorías, imagen, código de barras, por pieza o por kilo, activar/desactivar.
- **Catálogo de 7,000+ productos mexicanos** con código (sin precios) e **importación desde
  Excel**; **alta escaneando** un código nuevo.
- **Plantilla de pollería** de un clic (pollos, paquetes, complementos, bebidas, envío).
- **Paquetes y presentaciones**: un producto lleva otros ("Medio pollo" = 0.5 de "Pollo
  entero"; el paquete lleva pollo, tortillas y refresco) y descuenta su inventario.
- **Inventario** opcional por producto: entradas, conteos, historial, existencia mínima y
  aviso en el tablero. La venta nunca se bloquea por falta de existencia.

### Fiado

- Cuenta por cliente: qué se llevó, cuánto debe y desde cuándo; abonos por cualquier medio.

### Para el dueño

- **Tablero en vivo**, historial de ventas con filtros, **cortes por cajero**.
- **Reportes** diarios, semanales y mensuales con productos más vendidos, en Excel y PDF.
- Panel del dueño **desde el celular** (en el WiFi del negocio).

### Funcionamiento y seguridad

- **Sin internet**: servidor en una PC del negocio; **varias cajas a la vez** (computadora,
  laptop o tableta) en tiempo real. Se instala como app.
- Usuarios **administrador** y **cajero**; un usuario desactivado pierde acceso al instante.
  Freno contra adivinar contraseñas.
- Conexión con candado (HTTPS) entre cajas y servidor.
- **Respaldo automático** al cerrar caja y una vez al día; se guardan los últimos 30.
- Probado con varias cajas vendiendo a la vez (1,000 ventas seguidas sin errores, inventario
  y cortes exactos).

## Cuidado con estas promesas

- "Desde el celular" es **dentro del negocio** (mismo WiFi); verlo desde casa necesita VPN y
  es servicio aparte. La **caja** es para computadora o tableta.
- El catálogo de abarrotes trae nombres, códigos y categorías, **no precios**; la plantilla de
  pollería trae precios **de ejemplo**.
- Las **mesas** son cuentas que se cobran en caja; no hay comandero para meseros ni división
  de cuenta.
- El inventario no maneja caducidades, lotes ni variantes (tallas/colores).

## Datos de prueba

Para enseñar el sistema o probar una instalación de prueba con datos de una pollería:

```bash
POS_URL=https://<ip-del-servidor>:3000 POS_ADMIN_PASS='<contraseña de admin del POS>' \
  node_modules/.bin/tsx scripts/demo-polleria.ts
```

Carga la plantilla, inventario, los cobradores `lupita` y `beto` (`pollo1234`), clientes,
36 ventas del día, encargos y mesas. Sólo acepta servidores en red privada: **nunca** se
corre en el servidor de un cliente real.
