import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeftRight,
  Banknote,
  BookUser,
  ClipboardList,
  Clock3,
  Lock,
  PackageOpen,
  PencilLine,
  Receipt,
  Search,
  Trash2
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  AddToSaleResponse,
  Category,
  CreateOrderResponse,
  CreateSaleResponse,
  Order,
  ProductWithCategory
} from '@shared/types'
import { getCategorias, getProductos } from '@/api/catalogo'
import { abrirCajon, cajonActivo, getSesionActiva } from '@/api/caja'
import { listarEncargos } from '@/api/encargos'
import { reimprimirVenta } from '@/api/ventas'
import { ApiRequestError } from '@/api/client'
import { AgregarCobroModal } from '@/components/AgregarCobroModal'
import { CarritoItem } from '@/components/CarritoItem'
import { CobroModal } from '@/components/CobroModal'
import { EncargoFormModal } from '@/components/EncargoFormModal'
import { EncargosModal } from '@/components/EncargosModal'
import { MovimientoCajaModal } from '@/components/MovimientoCajaModal'
import { OpcionesModal } from '@/components/OpcionesModal'
import { PrecioLibreModal } from '@/components/PrecioLibreModal'
import { ProductoBtn } from '@/components/ProductoBtn'
import { VentasTurnoModal } from '@/components/VentasTurnoModal'
import { useBarcodeScanner } from '@/lib/barcode-scanner'
import { useNow } from '@/hooks/useNow'
import { dateTime, money, timeOnly } from '@/lib/format'
import { socket } from '@/lib/socket'
import { type AppendTarget, cartTotal, useCartStore } from '@/stores/cart.store'
import { useSocketStore } from '@/stores/socket.store'

type Load = 'loading' | 'no-caja' | 'ready' | 'error'

export default function PanelVenta(): React.JSX.Element {
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>('loading')
  const [products, setProducts] = useState<ProductWithCategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [activeCat, setActiveCat] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [cobroOpen, setCobroOpen] = useState(false)
  const [movimientoOpen, setMovimientoOpen] = useState(false)
  const [ventasOpen, setVentasOpen] = useState(false)
  const [hasDrawer, setHasDrawer] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  /** Producto de precio libre al que se le está escribiendo el importe. */
  const [libre, setLibre] = useState<ProductWithCategory | null>(null)
  /** Producto con opciones ("Pollo entero") al que se le está eligiendo el tipo. */
  const [conOpciones, setConOpciones] = useState<ProductWithCategory | null>(null)
  const [encargoOpen, setEncargoOpen] = useState(false)
  const [encargosOpen, setEncargosOpen] = useState(false)
  const [pendingOrders, setPendingOrders] = useState(0)
  const revision = useSocketStore((s) => s.revision)

  // Selectores puntuales: la grilla de productos no se re-renderiza al cambiar el carrito.
  const items = useCartStore((s) => s.items)
  const addItem = useCartStore((s) => s.addItem)
  const addOpenItem = useCartStore((s) => s.addOpenItem)
  const setQty = useCartStore((s) => s.setQty)
  const setPrice = useCartStore((s) => s.setPrice)
  const removeItem = useCartStore((s) => s.removeItem)
  const clear = useCartStore((s) => s.clear)
  const appendTo = useCartStore((s) => s.appendTo)
  const setAppendTo = useCartStore((s) => s.setAppendTo)
  const setNote = useCartStore((s) => s.setNote)
  const delivery = useCartStore((s) => s.delivery)
  const loadOrder = useCartStore((s) => s.loadOrder)
  const total = useMemo(() => cartTotal(items), [items])
  // Entrega de un encargo: se cobra lo que resta después del anticipo.
  const deposit = delivery?.deposit ?? 0
  const toCharge = Math.max(0, Math.round((total - deposit) * 100) / 100)

  const loadCatalog = useCallback(async () => {
    const [prods, cats] = await Promise.all([getProductos(), getCategorias()])
    setProducts(prods)
    setCategories(cats)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sesion = await getSesionActiva()
        if (cancelled) return
        if (!sesion) {
          setLoad('no-caja')
          return
        }
        setOpenedAt(sesion.openedAt)
        await loadCatalog()
        // Sin cajón configurado el botón no aparece; si la consulta falla, tampoco.
        const drawer = await cajonActivo().catch(() => false)
        if (!cancelled) {
          setHasDrawer(drawer)
          setLoad('ready')
        }
      } catch {
        if (!cancelled) setLoad('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadCatalog])

  // Cuántos encargos hay pendientes (el número en el botón); se refresca con cada evento.
  useEffect(() => {
    if (load !== 'ready') return
    listarEncargos('PENDING')
      .then((list) => setPendingOrders(list.length))
      .catch(() => {})
  }, [load, revision])

  // El admin edita un producto -> recargar el grid sin refrescar la página.
  useEffect(() => {
    const reload = (): void => {
      void loadCatalog()
    }
    socket.on('producto:update', reload)
    return () => {
      socket.off('producto:update', reload)
    }
  }, [loadCatalog])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter(
      (p) =>
        (activeCat === null || p.categoryId === activeCat) &&
        (term === '' || p.name.toLowerCase().includes(term) || p.barcode === search.trim())
    )
  }, [products, activeCat, search])

  /** Botón "Varios": el producto de precio libre llamado así, o el primero que haya. */
  const varios = useMemo(() => {
    const libres = products.filter((p) => p.openPrice === 1)
    return libres.find((p) => p.name.trim().toLowerCase() === 'varios') ?? libres[0] ?? null
  }, [products])

  /** Tocar o escanear: los de precio libre piden el importe; los demás van directo al carrito. */
  const select = useCallback(
    (product: ProductWithCategory): void => {
      if (product.openPrice === 1) setLibre(product)
      else if (product.options.length > 0) setConOpciones(product)
      else addItem(product)
    },
    [addItem]
  )

  const byBarcode = useMemo(
    () => new Map(products.flatMap((p) => (p.barcode ? [[p.barcode, p] as const] : []))),
    [products]
  )

  /** Agrega el producto del código escaneado. El catálogo ya está en memoria: sin ida al servidor. */
  const scan = useCallback(
    (code: string): boolean => {
      const product = byBarcode.get(code.trim())
      if (!product) {
        toast.error(`El código ${code.trim()} no está registrado`, {
          description:
            'Véndelo con un producto parecido y pide al administrador que lo dé de alta: en Productos, con escanearlo basta.',
          duration: 8000
        })
        return false
      }
      select(product)
      return true
    },
    [byBarcode, select]
  )

  const modalOpen =
    cobroOpen ||
    movimientoOpen ||
    ventasOpen ||
    libre !== null ||
    conOpciones !== null ||
    encargoOpen ||
    encargosOpen

  // Con un modal abierto el lector no agrega nada detrás (el cobro ya está en curso).
  useBarcodeScanner(scan, load === 'ready' && !modalOpen)

  // F2 = cobrar "Varios" sin soltar el teclado.
  useEffect(() => {
    if (load !== 'ready' || !varios || modalOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F2') return
      e.preventDefault()
      setLibre(varios)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [load, varios, modalOpen])

  /** Enter en el buscador: si es un código (lector o tecleado a mano), agrega ese producto. */
  function onSearchEnter(): void {
    const term = search.trim()
    if (!term || /\s/.test(term)) return
    // Un nombre que sí filtra productos no es un código desconocido: no se avisa nada.
    if (!byBarcode.has(term) && visible.length > 0) return
    if (scan(term)) setSearch('')
  }

  async function openDrawer(): Promise<void> {
    setOpening(true)
    try {
      const r = await abrirCajon()
      if (!r.opened) toast.error(r.error ?? 'El cajón no está configurado.')
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo abrir el cajón.')
    } finally {
      setOpening(false)
    }
  }

  function onSaleDone(sale: CreateSaleResponse): void {
    const delivered = delivery
    clear()
    setCobroOpen(false)
    if (delivered) {
      toast.success(
        `Encargo #${delivered.orderId} entregado · venta #${sale.ticketNumber} por ${money(sale.total)}`
      )
    } else if (sale.creditAccountId) {
      const debt = sale.total - (sale.amountPaid ?? 0)
      toast.success(`Venta #${sale.ticketNumber} a crédito · queda a deber ${money(debt)}`)
    } else {
      toast.success(`Venta #${sale.ticketNumber} registrada · ${money(sale.total)}`)
    }
    // Sin impresora activada (decisión del negocio) no se avisa nada: sólo si falló.
    if (!sale.print.printed && !sale.print.skipped) warnNotPrinted(sale)
  }

  function onAddDone(sale: AddToSaleResponse): void {
    clear()
    setCobroOpen(false)
    toast.success(
      `Se agregaron ${money(sale.addedTotal)} a la venta #${sale.ticketNumber} · nuevo total ${money(sale.total)}` +
        (sale.addedChange ? ` · cambio ${money(sale.addedChange)}` : '')
    )
    if (!sale.print.printed && !sale.print.skipped) warnNotPrinted(sale)
  }

  /** Aviso de ticket no impreso con botón para reintentar (se acabó el papel, tapa abierta…). */
  function warnNotPrinted(sale: CreateSaleResponse): void {
    toast.warning(
      `Ticket #${sale.ticketNumber} no impreso: ${sale.print.error ?? 'impresora no disponible'}`,
      {
        duration: 15_000,
        action: {
          label: 'Reimprimir',
          onClick: () => {
            reimprimirVenta(sale.id)
              .then(() => toast.success(`Ticket #${sale.ticketNumber} reimpreso`))
              .catch((err) =>
                toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo reimprimir')
              )
          }
        }
      }
    )
  }

  function onOrderDone(res: CreateOrderResponse): void {
    clear()
    setEncargoOpen(false)
    const change = res.depositSale?.change
    toast.success(
      `Encargo #${res.order.id} de ${res.order.customerName} · pasa ${dateTime(res.order.pickupAt)}` +
        (res.order.deposit > 0 ? ` · anticipo ${money(res.order.deposit)}` : '') +
        (change ? ` · cambio ${money(change)}` : ''),
      { duration: 8000 }
    )
    if (!res.print.printed && !res.print.skipped) {
      toast.warning(`Comprobante no impreso: ${res.print.error ?? 'impresora no disponible'}`)
    }
  }

  function startDelivery(order: Order): void {
    const missing = loadOrder(order, products)
    setEncargosOpen(false)
    if (missing.length > 0) {
      toast.warning(
        `Ya no se venden: ${missing.join(', ')}. Agrega algo parecido o cóbralo con Varios.`,
        { duration: 10_000 }
      )
    } else {
      toast.info(`Revisa el pedido de ${order.customerName} y toca "Cobrar".`)
    }
  }

  function startAppend(target: AppendTarget): void {
    setAppendTo(target)
    setVentasOpen(false)
    toast.info(`Agrega lo que falta y toca "Agregar a #${target.ticketNumber}".`)
  }

  if (load === 'loading') {
    return <Centered>Cargando…</Centered>
  }

  if (load === 'error') {
    return <Centered>No se pudo cargar el catálogo.</Centered>
  }

  if (load === 'no-caja') {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">No tienes una caja abierta.</p>
        <button
          onClick={() => navigate('/cobrador/apertura')}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-ring bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-md transition hover:brightness-125"
        >
          <Banknote size={20} /> Abrir caja
        </button>
      </Centered>
    )
  }

  return (
    <div className="grid h-full grid-cols-[1fr_360px]">
      {/* Grid de productos */}
      <div className="flex min-h-0 flex-col border-r border-border">
        <div className="space-y-2 border-b border-border p-3">
          <div className="relative">
            <Search
              size={18}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                onSearchEnter()
              }}
              placeholder="Buscar producto o escanear código…"
              className="w-full rounded-lg border border-input bg-background py-2.5 pr-3 pl-10 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CatTab active={activeCat === null} onClick={() => setActiveCat(null)}>
              Todo
            </CatTab>
            {categories.map((c) => (
              <CatTab key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
                {c.name}
              </CatTab>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {visible.length === 0 ? (
            <p className="pt-8 text-center text-sm text-muted-foreground">Sin productos.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
              {visible.map((p) => (
                <ProductoBtn key={p.id} product={p} onSelect={select} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Carrito */}
      <div className="flex min-h-0 flex-col bg-card">
        <div className="border-b border-border p-3">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(60px,1fr))] gap-1.5">
            {varios && (
              <ToolButton
                icon={PencilLine}
                label="Varios"
                title={`Cobrar un importe libre (F2) con "${varios.name}"`}
                onClick={() => setLibre(varios)}
              />
            )}
            <ToolButton icon={Receipt} label="Ventas" onClick={() => setVentasOpen(true)} />
            <ToolButton
              icon={ClipboardList}
              label="Encargos"
              badge={pendingOrders}
              onClick={() => setEncargosOpen(true)}
            />
            <ToolButton
              icon={BookUser}
              label="Cuentas"
              onClick={() => navigate('/cobrador/cuentas')}
            />
            <ToolButton
              icon={ArrowLeftRight}
              label="Efectivo"
              onClick={() => setMovimientoOpen(true)}
            />
            {hasDrawer && (
              <ToolButton
                icon={PackageOpen}
                label={opening ? 'Abriendo…' : 'Cajón'}
                onClick={() => void openDrawer()}
                disabled={opening}
              />
            )}
            <ToolButton
              icon={Lock}
              label="Cerrar caja"
              onClick={() => navigate('/cobrador/cierre')}
              danger
            />
          </div>
          <div className="mt-2.5 space-y-0.5">
            <p className="text-sm font-semibold">
              Carrito · {items.length} {items.length === 1 ? 'producto' : 'productos'}
            </p>
            {openedAt != null && <TurnoDesde openedAt={openedAt} />}
          </div>
        </div>

        {appendTo && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-pos-warning/15 px-4 py-2 text-xs">
            <span>
              Agregando a la venta <strong>#{appendTo.ticketNumber}</strong> (
              {money(appendTo.total)}): se cobra sólo lo nuevo.
            </span>
            <button
              onClick={() => setAppendTo(null)}
              className="shrink-0 rounded-md border border-border px-2 py-0.5 font-medium transition hover:bg-secondary"
            >
              Cancelar
            </button>
          </div>
        )}

        {delivery && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-pos-warning/15 px-4 py-2 text-xs">
            <span>
              Entregando el encargo <strong>#{delivery.orderId}</strong> de {delivery.customerName}
              {deposit > 0 && <> · ya dejó {money(deposit)}</>}
            </span>
            <button
              onClick={clear}
              className="shrink-0 rounded-md border border-border px-2 py-0.5 font-medium transition hover:bg-secondary"
            >
              Cancelar
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {items.length === 0 ? (
            <p className="pt-8 text-center text-sm text-muted-foreground">
              Toca un producto o escanea su código.
            </p>
          ) : (
            items.map((it) => (
              <CarritoItem
                key={it.key}
                item={it}
                onQty={setQty}
                onPrice={setPrice}
                onRemove={removeItem}
                onNote={setNote}
              />
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-border p-4">
          {deposit > 0 && (
            <div className="space-y-0.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Pedido</span>
                <span className="tabular-nums">{money(total)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Anticipo</span>
                <span className="tabular-nums">−{money(deposit)}</span>
              </div>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-base text-muted-foreground">
              {deposit > 0 ? 'Resta' : 'Total'}
            </span>
            <span className="text-3xl font-bold tabular-nums">{money(toCharge)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <button
              onClick={() => setCobroOpen(true)}
              disabled={items.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-pos-success px-4 py-3.5 text-lg font-bold text-white shadow-md transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              <Banknote size={22} />
              {appendTo ? `Agregar a #${appendTo.ticketNumber}` : 'Cobrar'}
            </button>
            <button
              onClick={() => setEncargoOpen(true)}
              disabled={items.length === 0 || !!appendTo || !!delivery}
              title="Guardar como encargo: pasan por él después (con o sin anticipo)"
              className="inline-flex flex-col items-center justify-center gap-0.5 rounded-xl border border-input bg-secondary px-3 py-2 text-xs font-medium transition hover:border-ring disabled:opacity-40"
            >
              <ClipboardList size={18} />
              Encargo
            </button>
            <button
              onClick={clear}
              disabled={items.length === 0}
              title="Vaciar el carrito"
              className="inline-flex flex-col items-center justify-center gap-0.5 rounded-xl border border-input bg-secondary px-4 py-2 text-xs font-medium transition hover:border-destructive hover:text-destructive disabled:opacity-40"
            >
              <Trash2 size={18} />
              Vaciar
            </button>
          </div>
        </div>
      </div>

      {cobroOpen &&
        (appendTo ? (
          <AgregarCobroModal
            target={appendTo}
            added={total}
            onClose={() => setCobroOpen(false)}
            onDone={onAddDone}
          />
        ) : (
          <CobroModal total={toCharge} onClose={() => setCobroOpen(false)} onDone={onSaleDone} />
        ))}
      {ventasOpen && (
        <VentasTurnoModal
          cartBusy={items.length > 0 && !appendTo}
          onClose={() => setVentasOpen(false)}
          onAppend={startAppend}
        />
      )}
      {movimientoOpen && <MovimientoCajaModal onClose={() => setMovimientoOpen(false)} />}
      {encargoOpen && (
        <EncargoFormModal
          total={total}
          onClose={() => setEncargoOpen(false)}
          onDone={onOrderDone}
        />
      )}
      {encargosOpen && (
        <EncargosModal
          cartBusy={items.length > 0}
          onClose={() => setEncargosOpen(false)}
          onDeliver={startDelivery}
        />
      )}
      {conOpciones && (
        <OpcionesModal
          product={conOpciones}
          onClose={() => setConOpciones(null)}
          onAdd={(options, note) => {
            addItem(conOpciones, options, note)
            setConOpciones(null)
          }}
        />
      )}
      {libre && (
        <PrecioLibreModal
          product={libre}
          onClose={() => setLibre(null)}
          onAdd={(price, note) => {
            addOpenItem(libre, price, note)
            setLibre(null)
          }}
        />
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      {children}
    </div>
  )
}

function CatTab({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
        active
          ? 'border-ring bg-primary text-primary-foreground shadow-sm'
          : 'border-input bg-secondary text-foreground hover:brightness-125'
      }`}
    >
      {children}
    </button>
  )
}

/** Botón de la barra del cobrador: ícono grande + texto, fácil de tocar en pantalla táctil. */
function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
  title,
  badge
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
  /** Número en la esquina (encargos pendientes); 0 = no se muestra. */
  badge?: number
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`relative flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium whitespace-nowrap shadow-sm transition active:scale-[0.97] disabled:opacity-50 ${
        danger
          ? 'border-destructive/60 bg-destructive/10 text-red-300 hover:bg-destructive/25'
          : 'border-input bg-secondary text-foreground hover:border-ring hover:brightness-125'
      }`}
    >
      <Icon size={20} />
      {label}
      {!!badge && (
        <span className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-pos-warning px-1 text-[11px] font-bold text-black">
          {badge}
        </span>
      )}
    </button>
  )
}

/** "Turno desde las 9:43 a. m. · 2 h 05 min" — se actualiza cada 30 s. */
function TurnoDesde({ openedAt }: { openedAt: number }): React.JSX.Element {
  const now = useNow(30_000)
  const mins = Math.max(0, Math.floor((now.getTime() / 1000 - openedAt) / 60))
  const days = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const dur =
    days > 0
      ? `${days} d ${h} h`
      : h > 0
        ? `${h} h ${String(mins % 60).padStart(2, '0')} min`
        : `${mins} min`
  // Caja abierta desde otro día (se olvidó cerrar): se muestra la fecha para que se note.
  const opened = new Date(openedAt * 1000)
  const sameDay = opened.toDateString() === now.toDateString()
  const desde = sameDay
    ? `las ${timeOnly(openedAt)}`
    : `el ${opened.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}, ${timeOnly(openedAt)}`
  return (
    <p
      className={`flex items-center gap-1 text-xs ${sameDay ? 'text-muted-foreground' : 'text-pos-warning'}`}
      title="Hora en que abriste la caja"
    >
      <Clock3 size={13} className="shrink-0" />
      Turno desde {desde} · {dur}
    </p>
  )
}
