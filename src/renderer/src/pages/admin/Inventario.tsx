import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PackagePlus } from 'lucide-react'
import type { InventoryItem, StockStatus } from '@shared/types'
import { getInventario } from '@/api/admin'
import {
  ActivarInventarioModal,
  AjusteModal,
  EntradaModal,
  MovimientosModal
} from '@/components/admin/InventarioModals'
import { useBarcodeScanner } from '@/lib/barcode-scanner'
import { formatStock } from '@/lib/format'
import { useSocketStore } from '@/stores/socket.store'

type Filter = 'all' | 'low' | 'out'
type Dialog = { kind: 'entrada' | 'ajuste' | 'movs'; item: InventoryItem } | { kind: 'activar' }

const STATUS: Record<StockStatus, { label: string; className: string }> = {
  OUT: { label: 'Agotado', className: 'bg-pos-danger/15 text-pos-danger' },
  LOW: { label: 'Por agotarse', className: 'bg-pos-warning/20 text-pos-warning' },
  OK: { label: 'Bien', className: 'bg-pos-success/15 text-pos-success' }
}

export default function Inventario(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const filter: Filter =
    params.get('f') === 'low' || params.get('f') === 'out' ? (params.get('f') as Filter) : 'all'
  const [rows, setRows] = useState<InventoryItem[] | null>(null)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [nonce, setNonce] = useState(0)
  // Ventas y movimientos de otras cajas/pantallas → refresco en vivo.
  const revision = useSocketStore((s) => s.revision)

  useEffect(() => {
    let cancelled = false
    getInventario()
      .then((r) => {
        if (cancelled) return
        setRows(r)
        setError(false)
      })
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [nonce, revision])

  const counts = useMemo(() => {
    const all = rows ?? []
    return {
      all: all.length,
      low: all.filter((r) => r.status !== 'OK').length,
      out: all.filter((r) => r.status === 'OUT').length
    }
  }, [rows])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (r) =>
        (filter === 'all' || (filter === 'low' ? r.status !== 'OK' : r.status === 'OUT')) &&
        (term === '' ||
          r.name.toLowerCase().includes(term) ||
          r.barcode === search.trim() ||
          (r.categoryName ?? '').toLowerCase().includes(term))
    )
  }, [rows, filter, search])

  // Llegó mercancía: escanear el producto abre su entrada.
  useBarcodeScanner(
    (code) => {
      const item = rows?.find((r) => r.barcode === code)
      if (item) setDialog({ kind: 'entrada', item })
      else toast.error(`El código ${code} no está en el inventario`)
    },
    rows !== null && dialog === null
  )

  function setFilter(f: Filter): void {
    setParams(f === 'all' ? {} : { f }, { replace: true })
  }

  function onChanged(updated: InventoryItem): void {
    setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev)
    setDialog(null)
  }

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Inventario</h1>
        <button
          onClick={() => setDialog({ kind: 'activar' })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          <PackagePlus size={15} /> Agregar productos
        </button>
      </header>

      <p className="mb-3 text-sm text-muted-foreground">
        Cada venta descuenta sola. Cuando llegue mercancía toca <strong>Entrada</strong> (o escanea
        el producto); cuando cuentes el anaquel, <strong>Contar</strong>.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          Todos ({counts.all})
        </FilterChip>
        <FilterChip active={filter === 'low'} onClick={() => setFilter('low')} tone="warn">
          Por agotarse ({counts.low})
        </FilterChip>
        <FilterChip active={filter === 'out'} onClick={() => setFilter('out')} tone="danger">
          Agotados ({counts.out})
        </FilterChip>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, categoría o código…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 sm:ml-auto sm:w-72"
        />
      </div>

      {error ? (
        <p className="text-sm text-pos-danger">No se pudo cargar el inventario.</p>
      ) : rows === null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <p>Todavía no llevas inventario de ningún producto.</p>
          <p className="mt-1">
            Toca <strong>Agregar productos</strong>, o marca &quot;Llevar inventario&quot; al dar de
            alta un producto.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2">Producto</th>
                <th className="hidden px-3 py-2 md:table-cell">Categoría</th>
                <th className="px-3 py-2 text-right">Hay</th>
                <th className="hidden px-3 py-2 text-right md:table-cell">Mínimo</th>
                <th className="hidden px-3 py-2 sm:table-cell">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Ningún producto coincide.
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <span
                        className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium sm:hidden ${STATUS[r.status].className}`}
                      >
                        {STATUS[r.status].label}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                      {r.categoryName ?? '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums ${
                        r.status === 'OUT' ? 'text-pos-danger' : ''
                      }`}
                    >
                      {formatStock(r.stock, r.unit)}
                    </td>
                    <td className="hidden px-3 py-2 text-right text-muted-foreground tabular-nums md:table-cell">
                      {r.minStock == null ? '—' : formatStock(r.minStock, r.unit)}
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].className}`}
                      >
                        {STATUS[r.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm font-medium">
                        <button
                          onClick={() => setDialog({ kind: 'entrada', item: r })}
                          className="text-pos-success hover:underline"
                        >
                          Entrada
                        </button>
                        <button
                          onClick={() => setDialog({ kind: 'ajuste', item: r })}
                          className="hover:underline"
                        >
                          Contar
                        </button>
                        <button
                          onClick={() => setDialog({ kind: 'movs', item: r })}
                          className="text-muted-foreground hover:underline"
                        >
                          Historial
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'entrada' && (
        <EntradaModal item={dialog.item} onClose={() => setDialog(null)} onDone={onChanged} />
      )}
      {dialog?.kind === 'ajuste' && (
        <AjusteModal item={dialog.item} onClose={() => setDialog(null)} onDone={onChanged} />
      )}
      {dialog?.kind === 'movs' && (
        <MovimientosModal item={dialog.item} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'activar' && (
        <ActivarInventarioModal
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            setNonce((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  tone,
  children
}: {
  active: boolean
  onClick: () => void
  tone?: 'warn' | 'danger'
  children: React.ReactNode
}): React.JSX.Element {
  const idle =
    tone === 'danger' ? 'text-pos-danger' : tone === 'warn' ? 'text-pos-warning' : 'text-foreground'
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : `border-border bg-background hover:bg-secondary ${idle}`
      }`}
    >
      {children}
    </button>
  )
}
