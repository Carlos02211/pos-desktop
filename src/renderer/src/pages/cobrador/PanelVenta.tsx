import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Category, CreateSaleResponse, ProductWithCategory } from '@shared/types'
import { getCategorias, getProductos } from '@/api/catalogo'
import { getSesionActiva } from '@/api/caja'
import { CarritoItem } from '@/components/CarritoItem'
import { CobroModal } from '@/components/CobroModal'
import { MovimientoCajaModal } from '@/components/MovimientoCajaModal'
import { ProductoBtn } from '@/components/ProductoBtn'
import { useBarcodeScanner } from '@/lib/barcode-scanner'
import { money } from '@/lib/format'
import { socket } from '@/lib/socket'
import { cartCount, cartTotal, useCartStore } from '@/stores/cart.store'

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

  // Selectores puntuales: la grilla de productos no se re-renderiza al cambiar el carrito.
  const items = useCartStore((s) => s.items)
  const addItem = useCartStore((s) => s.addItem)
  const setQty = useCartStore((s) => s.setQty)
  const setPrice = useCartStore((s) => s.setPrice)
  const removeItem = useCartStore((s) => s.removeItem)
  const clear = useCartStore((s) => s.clear)
  const total = useMemo(() => cartTotal(items), [items])

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
        await loadCatalog()
        if (!cancelled) setLoad('ready')
      } catch {
        if (!cancelled) setLoad('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadCatalog])

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

  const byBarcode = useMemo(
    () => new Map(products.flatMap((p) => (p.barcode ? [[p.barcode, p] as const] : []))),
    [products]
  )

  /** Agrega el producto del código escaneado. El catálogo ya está en memoria: sin ida al servidor. */
  const scan = useCallback(
    (code: string): boolean => {
      const product = byBarcode.get(code.trim())
      if (!product) {
        toast.error(`No hay ningún producto con el código ${code.trim()}`)
        return false
      }
      addItem(product)
      return true
    },
    [byBarcode, addItem]
  )

  // Con un modal abierto el lector no agrega nada detrás (el cobro ya está en curso).
  useBarcodeScanner(scan, load === 'ready' && !cobroOpen && !movimientoOpen)

  /** Enter en el buscador: si es un código (lector o tecleado a mano), agrega ese producto. */
  function onSearchEnter(): void {
    const term = search.trim()
    if (!term || /\s/.test(term)) return
    // Un nombre que sí filtra productos no es un código desconocido: no se avisa nada.
    if (!byBarcode.has(term) && visible.length > 0) return
    if (scan(term)) setSearch('')
  }

  function onSaleDone(sale: CreateSaleResponse): void {
    clear()
    setCobroOpen(false)
    if (sale.creditAccountId) {
      const debt = sale.total - (sale.amountPaid ?? 0)
      toast.success(`Venta #${sale.ticketNumber} a crédito · queda a deber ${money(debt)}`)
    } else {
      toast.success(`Venta #${sale.ticketNumber} registrada · ${money(sale.total)}`)
    }
    // Sin impresora activada (decisión del negocio) no se avisa nada: sólo si falló.
    if (!sale.print.printed && !sale.print.skipped) {
      toast.warning(`Ticket no impreso: ${sale.print.error ?? 'impresora no disponible'}`)
    }
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
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Abrir caja
        </button>
      </Centered>
    )
  }

  return (
    <div className="grid h-full grid-cols-[1fr_360px]">
      {/* Grid de productos */}
      <div className="flex min-h-0 flex-col border-r border-border">
        <div className="space-y-2 border-b border-border p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              onSearchEnter()
            }}
            placeholder="Buscar producto o escanear código…"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
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
                <ProductoBtn key={p.id} product={p} onSelect={addItem} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Carrito */}
      <div className="flex min-h-0 flex-col bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm font-semibold">
          <span>Carrito · {cartCount(items)} art.</span>
          <div className="flex gap-1.5">
            <button
              onClick={() => navigate('/cobrador/cuentas')}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-secondary"
            >
              Cuentas
            </button>
            <button
              onClick={() => setMovimientoOpen(true)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-secondary"
            >
              Efectivo
            </button>
            <button
              onClick={() => navigate('/cobrador/cierre')}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-secondary"
            >
              Cerrar caja
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {items.length === 0 ? (
            <p className="pt-8 text-center text-sm text-muted-foreground">
              Toca un producto o escanea su código.
            </p>
          ) : (
            items.map((it) => (
              <CarritoItem
                key={it.productId}
                item={it}
                onQty={setQty}
                onPrice={setPrice}
                onRemove={removeItem}
              />
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-border p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-2xl font-bold">{money(total)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              onClick={() => setCobroOpen(true)}
              disabled={items.length === 0}
              className="rounded-lg bg-pos-success px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Cobrar
            </button>
            <button
              onClick={clear}
              disabled={items.length === 0}
              className="rounded-lg border border-border px-3 py-2.5 text-sm transition hover:bg-secondary disabled:opacity-50"
            >
              Vaciar
            </button>
          </div>
        </div>
      </div>

      {cobroOpen && (
        <CobroModal total={total} onClose={() => setCobroOpen(false)} onDone={onSaleDone} />
      )}
      {movimientoOpen && <MovimientoCajaModal onClose={() => setMovimientoOpen(false)} />}
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
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-foreground hover:brightness-110'
      }`}
    >
      {children}
    </button>
  )
}
