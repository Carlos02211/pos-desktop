/**
 * Llena un servidor de PRUEBA con datos de una pollería / rosticería para revisar el sistema
 * a mano: catálogo (plantilla de pollería), inventario, cobradores, clientes, ventas del día
 * (con opciones, notas, paquetes, fiado), encargos, mesas abiertas y movimientos de efectivo.
 *
 * Todo entra por la API, igual que si alguien usara el sistema: existencias, folios, cortes y
 * reportes cuadran. Se puede correr más de una vez (lo que ya existe se reutiliza; las ventas,
 * encargos y mesas se agregan de nuevo).
 *
 * NUNCA contra un negocio real: crea ventas y mueve existencias. Por eso sólo acepta
 * servidores en red privada (192.168.x, 10.x, 172.16–31.x, localhost).
 *
 * Uso:
 *   POS_URL=https://192.168.122.233:3000 POS_ADMIN_PASS=admin123 \
 *     node_modules/.bin/tsx scripts/demo-polleria.ts
 *
 * Variables: POS_URL (obligatoria), POS_ADMIN_USER (admin), POS_ADMIN_PASS (admin123).
 * Los cobradores de prueba son `lupita` y `beto` con contraseña `pollo1234`.
 */
import type {
  CreateOrderResponse,
  CreateSaleResponse,
  LoginResponse,
  ProductWithCategory,
  TabResponse,
  TemplateResult
} from '../src/shared/types'

const BASE = process.env.POS_URL?.replace(/\/+$/, '')
const ADMIN_USER = process.env.POS_ADMIN_USER ?? 'admin'
const ADMIN_PASS = process.env.POS_ADMIN_PASS ?? 'admin123'
const CAJEROS = ['lupita', 'beto']
const CAJERO_PASS = 'pollo1234'

if (!BASE) {
  console.error('Falta POS_URL (ej. POS_URL=https://192.168.122.233:3000).')
  process.exit(1)
}
const host = new URL(BASE).hostname
if (!/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
  console.error(`Sólo para servidores de prueba en red privada; ${host} no lo parece.`)
  process.exit(1)
}
// El servidor de prueba usa un certificado de su propia CA: se acepta sólo en este script.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

type Call = <T = unknown>(path: string, method?: string, body?: unknown) => Promise<T>

async function request(
  token: string | null,
  path: string,
  method = 'GET',
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* respuesta sin JSON */
  }
  return { status: res.status, data }
}

function caller(token: string): Call {
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const { status, data } = await request(token, path, method, body)
    if (status >= 400) {
      const msg = (data as { error?: string } | null)?.error ?? JSON.stringify(data)
      throw new Error(`${method} ${path} -> ${status}: ${msg}`)
    }
    return data as T
  }
}

async function login(username: string, password: string): Promise<LoginResponse | null> {
  const { status, data } = await request(null, '/api/auth/login', 'POST', { username, password })
  return status === 200 ? (data as LoginResponse) : null
}

/** Aleatorio reproducible: cada corrida arma ventas parecidas pero no idénticas. */
let seed = Date.now() % 100_000
function rand(): number {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]

async function main(): Promise<void> {
  console.log(`Servidor: ${BASE}`)
  const adminLogin = await login(ADMIN_USER, ADMIN_PASS)
  if (!adminLogin) throw new Error(`No se pudo entrar como ${ADMIN_USER} (revisa POS_ADMIN_PASS).`)
  const admin = caller(adminLogin.token)

  // Sin impresora durante la carga: si no, cada venta mandaría su ticket.
  const config = await admin<Record<string, string>>('/api/config')
  const printerWasOn = config.printer_enabled === '1'
  if (printerWasOn) await admin('/api/config', 'PUT', { printer_enabled: '0' })

  try {
    // ---- Negocio y catálogo ----
    if (!config.business_name || config.business_name === 'Mi Negocio') {
      await admin('/api/config', 'PUT', {
        business_name: 'Pollos Asados El Güero',
        business_address: 'Av. Juárez 215, Centro',
        business_phone: '555 214 3080',
        ticket_footer: '¡Gracias por su preferencia! Pedidos al 555 214 3080'
      })
      console.log('✓ datos del negocio: Pollos Asados El Güero')
    }
    const plantilla = await admin<TemplateResult>('/api/productos/plantillas/polleria', 'POST')
    console.log(
      `✓ plantilla de pollería: ${plantilla.created.length} nuevos, ${plantilla.existing.length} ya estaban`
    )
    for (const f of plantilla.failed) console.log(`  · no se dio de alta ${f.name}: ${f.reason}`)

    const productos = await admin<ProductWithCategory[]>('/api/productos')
    const p = (name: string): ProductWithCategory => {
      const found = productos.find((x) => x.name === name)
      if (!found) throw new Error(`Falta el producto "${name}" (¿se desactivó?).`)
      return found
    }
    const opt = (product: ProductWithCategory, name: string): number => {
      const o = product.options.find((x) => x.name === name)
      if (!o) throw new Error(`"${product.name}" no tiene la opción "${name}".`)
      return o.id
    }
    const entero = p('Pollo entero')
    const medio = p('Medio pollo')
    const cuarto = p('Cuarto de pollo')
    const sencillo = p('Paquete sencillo (pollo, tortillas y salsa)')
    const familiar = p('Paquete familiar (pollo, guarnición, tortillas, salsa y refresco)')
    const paqMedio = p('Paquete medio pollo (guarnición y tortillas)')
    const tortillas = p('Tortillas 1/2 kg')
    const tortillasKg = p('Tortillas 1 kg')
    const salsa = p('Salsa')
    const arroz = p('Arroz')
    const espagueti = p('Espagueti')
    const frijoles = p('Frijoles charros')
    const papas = p('Papas a la francesa')
    const toreados = p('Chiles toreados')
    const refresco = p('Refresco 600 ml')
    const refresco2 = p('Refresco 2 L')
    const agua = p('Agua fresca 1 L')
    const envio = p('Envío a domicilio')

    // ---- Inventario: pollos del día, tortillas y refrescos ----
    await admin('/api/inventario/activar', 'POST', {
      productIds: [entero.id, tortillas.id, refresco.id, refresco2.id]
    })
    const conteo: [ProductWithCategory, number, string][] = [
      [entero, 60, 'Pollos preparados hoy'],
      [tortillas, 80, 'Llegó la tortillería'],
      [refresco, 48, 'Conteo de refrigerador'],
      [refresco2, 24, 'Conteo de refrigerador']
    ]
    for (const [prod, counted, reason] of conteo) {
      await admin(`/api/inventario/${prod.id}/ajuste`, 'POST', { counted, reason })
    }
    console.log('✓ inventario: 60 pollos, 80 tortillas, 48 refrescos chicos, 24 de 2 L')

    // ---- Cobradores con caja abierta ----
    const cajas: { name: string; call: Call }[] = []
    for (const name of CAJEROS) {
      let s = await login(name, CAJERO_PASS)
      if (!s) {
        await admin('/api/usuarios', 'POST', {
          username: name,
          password: CAJERO_PASS,
          role: 'COBRADOR'
        }).catch((err: Error) => {
          throw new Error(
            `No se pudo usar al cobrador "${name}": ya existe con otra contraseña. (${err.message})`
          )
        })
        s = await login(name, CAJERO_PASS)
      }
      const call = caller(s!.token)
      const activa = await call<unknown>('/api/caja/sesion-activa')
      if (!activa) await call('/api/caja/apertura', 'POST', { openingAmount: 800 })
      cajas.push({ name, call })
    }
    console.log(`✓ cobradores ${CAJEROS.join(' y ')} (contraseña ${CAJERO_PASS}) con caja abierta`)

    // ---- Clientes (para fiado y encargos) ----
    const existentes = await admin<{ id: number; name: string }[]>('/api/clientes')
    const clientes: Record<string, number> = {}
    for (const [name, phone, notes] of [
      ['Fonda La Güera', '555 301 1122', 'Paga los viernes'],
      ['Don Pepe Ramírez', '555 410 8890', ''],
      ['Taller Mecánico Hermanos Soto', '555 220 4471', 'Pedido de comida para 6 los sábados']
    ]) {
      const found = existentes.find((c) => c.name === name)
      clientes[name] =
        found?.id ??
        (
          await admin<{ id: number }>('/api/clientes', 'POST', {
            name,
            phone,
            ...(notes ? { notes } : {})
          })
        ).id
    }
    console.log('✓ clientes: Fonda La Güera, Don Pepe, Taller Hermanos Soto')

    // ---- Ventas del día ----
    const tipos = ['Natural', 'Adobado', 'Al carbón']
    const notas = ['', '', '', 'bien dorado', 'sin chile', 'partido en piezas', 'con mucha salsa']
    const guarniciones = ['Arroz', 'Espagueti', 'Ensalada de col']
    type Line = { productId: number; quantity: number; optionIds?: number[]; note?: string }
    const pollo = (prod: ProductWithCategory, qty = 1): Line => {
      const note = pick(notas)
      const optionIds = [opt(prod, pick(tipos))]
      if (prod.options.some((o) => o.groupName === 'Guarnición')) {
        optionIds.push(opt(prod, pick(guarniciones)))
      }
      return { productId: prod.id, quantity: qty, optionIds, ...(note ? { note } : {}) }
    }
    const simple = (prod: ProductWithCategory, qty = 1): Line => ({
      productId: prod.id,
      quantity: qty
    })
    const pedidos: (() => Line[])[] = [
      () => [pollo(entero), simple(tortillas), simple(salsa)],
      () => [pollo(medio), simple(tortillas)],
      () => [pollo(familiar)],
      () => [pollo(sencillo), simple(refresco2)],
      () => [pollo(paqMedio), simple(refresco)],
      () => [pollo(entero, 2), simple(tortillasKg), simple(frijoles), simple(refresco2)],
      () => [pollo(cuarto), simple(arroz), simple(agua)],
      () => [pollo(medio), simple(papas), simple(refresco, 2)],
      () => [simple(tortillas, 2), simple(salsa, 2)],
      () => [pollo(entero), simple(espagueti), simple(toreados), simple(tortillas)]
    ]
    const tally: Record<string, number> = { CASH: 0, CARD: 0, TRANSFER: 0, CREDIT: 0 }
    let vendido = 0
    for (let i = 0; i < 36; i++) {
      const caja = cajas[i % cajas.length]
      const items = pick(pedidos)()
      const r = rand()
      const method = r < 0.66 ? 'CASH' : r < 0.82 ? 'CARD' : r < 0.94 ? 'TRANSFER' : 'CREDIT'
      // El monto exacto no se conoce sin preguntar: se paga con un billete de $1,000 en efectivo.
      const sale = await caja.call<CreateSaleResponse>('/api/ventas', 'POST', {
        items,
        paymentMethod: method,
        ...(method === 'CASH' ? { amountPaid: 1000 } : {}),
        ...(method === 'CREDIT'
          ? { customerId: clientes[pick(Object.keys(clientes))], amountPaid: 0 }
          : {})
      })
      tally[method]++
      vendido += sale.total
    }
    console.log(
      `✓ 36 ventas por $${vendido.toFixed(2)} (efectivo ${tally.CASH}, tarjeta ${tally.CARD}, transferencia ${tally.TRANSFER}, fiado ${tally.CREDIT})`
    )

    // Un abono a lo que se fió.
    const cuentas = await admin<{ id: number; balance: number; status: string }[]>('/api/cuentas')
    const deuda = cuentas.find((c) => c.status === 'OPEN' && c.balance > 50)
    if (deuda) {
      await cajas[0].call(`/api/cuentas/${deuda.id}/abono`, 'POST', {
        amount: 50,
        paymentMethod: 'CASH'
      })
      console.log('✓ abono de $50 a una cuenta fiada')
    }

    // ---- Movimientos de efectivo ----
    await cajas[0].call('/api/caja/movimiento', 'POST', {
      type: 'OUT',
      amount: 180,
      reason: 'Bulto de carbón'
    })
    await cajas[1].call('/api/caja/movimiento', 'POST', {
      type: 'IN',
      amount: 200,
      reason: 'Cambio que dejó el dueño'
    })
    console.log('✓ retiro de $180 (carbón) e ingreso de $200 (cambio)')

    // ---- Encargos ----
    const hoy = new Date()
    const at = (dias: number, h: number, m = 0): number => {
      const d = new Date(hoy)
      d.setDate(d.getDate() + dias)
      d.setHours(h, m, 0, 0)
      // Si la hora de hoy ya pasó, se pasa a dentro de un rato.
      return Math.max(Math.floor(d.getTime() / 1000), Math.floor(Date.now() / 1000) + 45 * 60)
    }
    const encargos: { label: string; body: Record<string, unknown> }[] = [
      {
        label: 'Doña Rosa, 2 familiares, anticipo $200 efectivo',
        body: {
          customerName: 'Doña Rosa',
          phone: '555 123 4567',
          pickupAt: at(0, 14),
          notes: 'Pasa su hijo',
          items: [pollo(familiar, 2)],
          deposit: 200,
          depositMethod: 'CASH',
          amountPaid: 200
        }
      },
      {
        label: 'Taller Hermanos Soto, a domicilio, transferencia',
        body: {
          customerName: 'Taller Mecánico Hermanos Soto',
          phone: '555 220 4471',
          pickupAt: at(0, 15, 30),
          notes: 'A domicilio: Calle Morelos 88, frente a la gasolinera',
          items: [
            pollo(entero, 3),
            simple(tortillasKg, 2),
            simple(refresco2, 2),
            simple(envio)
          ].map((l) => (l.productId === envio.id ? { ...l, price: 30 } : l)),
          deposit: 300,
          depositMethod: 'TRANSFER'
        }
      },
      {
        label: 'Don Pepe, sin anticipo',
        body: {
          customerName: 'Don Pepe',
          pickupAt: at(0, 19),
          items: [pollo(medio), simple(papas)]
        }
      },
      {
        label: 'Fiesta de Karla, mañana, pagado completo',
        body: {
          customerName: 'Karla Méndez',
          phone: '555 908 1234',
          pickupAt: at(1, 13),
          notes: 'Fiesta infantil, llevar platos desechables',
          items: [pollo(familiar, 4), simple(agua, 4)],
          deposit: 0,
          depositMethod: 'CARD'
        }
      }
    ]
    for (const e of encargos) {
      // "Pagado completo": el anticipo es el total (catálogo + extras de las opciones).
      if (e.body.deposit === 0 && e.body.depositMethod) {
        e.body.deposit = (e.body.items as Line[]).reduce((sum, l) => {
          const prod = productos.find((x) => x.id === l.productId)!
          const extra = prod.options
            .filter((o) => l.optionIds?.includes(o.id))
            .reduce((t, o) => t + o.price, 0)
          return sum + (prod.price + extra) * l.quantity
        }, 0)
      }
      await cajas[1].call<CreateOrderResponse>('/api/encargos', 'POST', e.body)
      console.log(`✓ encargo: ${e.label}`)
    }
    // Uno se entrega y otro se cancela, para ver las dos pestañas.
    const entregar = await cajas[0].call<CreateOrderResponse>('/api/encargos', 'POST', {
      customerName: 'Martha (ya entregado)',
      pickupAt: at(0, 12),
      items: [pollo(entero)],
      deposit: 100,
      depositMethod: 'CASH',
      amountPaid: 100
    })
    await cajas[0].call('/api/ventas', 'POST', {
      items: entregar.order.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        optionIds: i.optionIds,
        note: i.note
      })),
      paymentMethod: 'CASH',
      amountPaid: 500,
      orderId: entregar.order.id
    })
    const cancelar = await cajas[0].call<CreateOrderResponse>('/api/encargos', 'POST', {
      customerName: 'Luis (canceló)',
      pickupAt: at(0, 18),
      items: [pollo(medio)]
    })
    await cajas[0].call(`/api/encargos/${cancelar.order.id}/cancelar`, 'POST', {})
    console.log('✓ un encargo entregado y uno cancelado')

    // ---- Mesas ----
    const abrir = async (
      caja: Call,
      name: string,
      rondas: Line[][]
    ): Promise<TabResponse['order'] | null> => {
      const abiertas = await caja<TabResponse['order'][]>('/api/cuentas-abiertas')
      if (abiertas.some((o) => o.customerName.toLowerCase() === name.toLowerCase())) {
        console.log(`  · la cuenta "${name}" ya estaba abierta: no se toca`)
        return null
      }
      let { order } = await caja<TabResponse>('/api/cuentas-abiertas', 'POST', {
        name,
        items: rondas[0]
      })
      for (const ronda of rondas.slice(1)) {
        order = (
          await caja<TabResponse>(`/api/cuentas-abiertas/${order.id}/agregar`, 'POST', {
            items: ronda
          })
        ).order
      }
      return order
    }
    await abrir(cajas[0].call, 'Mesa 1', [
      [pollo(entero), simple(tortillas), simple(salsa)],
      [simple(refresco, 3)],
      [simple(frijoles)]
    ])
    await abrir(cajas[1].call, 'Mesa 4', [[pollo(medio), simple(agua)], [simple(papas)]])
    await abrir(cajas[0].call, 'Barra', [[pollo(cuarto), simple(refresco)]])
    const cobrar = await abrir(cajas[1].call, 'Mesa 2', [
      [pollo(familiar)],
      [simple(refresco, 2), simple(toreados)]
    ])
    if (cobrar) {
      await cajas[1].call('/api/ventas', 'POST', {
        items: cobrar.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          optionIds: i.optionIds,
          note: i.note
        })),
        paymentMethod: 'CARD',
        orderId: cobrar.id,
        orderVersion: cobrar.version
      })
    }
    console.log('✓ mesas: "Mesa 1", "Mesa 4" y "Barra" abiertas; "Mesa 2" cobrada')

    const inv = await admin<{ name: string; stock: number }[]>('/api/inventario')
    const pollosQuedan = inv.find((i) => i.name === 'Pollo entero')?.stock
    console.log(`\n✅ Listo. Quedan ${pollosQuedan} pollos de 60.`)
    console.log(
      `   Entra como ${CAJEROS.join(' o ')} (${CAJERO_PASS}) para ver mesas y encargos, y como ${ADMIN_USER} para reportes, inventario y cortes.`
    )
  } finally {
    if (printerWasOn) await admin('/api/config', 'PUT', { printer_enabled: '1' })
  }
}

main().catch((err: Error) => {
  console.error(`\n❌ ${err.message}`)
  process.exit(1)
})
