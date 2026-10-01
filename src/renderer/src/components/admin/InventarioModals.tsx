import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  InventoryItem,
  ProductWithCategory,
  StockMovement,
  StockMovementType
} from '@shared/types'
import { ApiRequestError } from '@/api/client'
import {
  activarInventario,
  ajustarExistencia,
  getMovimientosInventario,
  listProductosAdmin,
  registrarEntrada
} from '@/api/admin'
import { Modal } from '@/components/Modal'
import { dateTime, formatStock } from '@/lib/format'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'
const primaryButton =
  'w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50'

function parseQty(text: string): number {
  return Number.parseFloat(text.replace(',', '.'))
}

/** Piezas: entero. Kg: hasta gramos. */
function validQty(value: number, unit: 'PIEZA' | 'KG', allowZero: boolean): boolean {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) return false
  return unit === 'KG' || Number.isInteger(value)
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback
}

/** Llegó mercancía: se suma a la existencia. */
export function EntradaModal({
  item,
  onClose,
  onDone
}: {
  item: InventoryItem
  onClose: () => void
  onDone: (item: InventoryItem) => void
}): React.JSX.Element {
  const [qtyText, setQtyText] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const qty = parseQty(qtyText)
  const valid = validQty(qty, item.unit, false)

  async function save(): Promise<void> {
    if (!valid) return
    setSaving(true)
    try {
      const updated = await registrarEntrada(item.id, { quantity: qty, reason: reason.trim() })
      toast.success(`Entrada registrada · ${item.name}: ${formatStock(updated.stock, item.unit)}`)
      onDone(updated)
    } catch (err) {
      toast.error(errorMessage(err, 'No se pudo registrar la entrada'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Entrada de mercancía" onClose={onClose} busy={saving}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
          <p className="font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            Hay ahora: {formatStock(item.stock, item.unit)}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            ¿Cuánto llegó? ({item.unit === 'KG' ? 'kg' : 'piezas'})
          </span>
          <input
            autoFocus
            inputMode="decimal"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            placeholder={item.unit === 'KG' ? '0.000' : '0'}
            className={`${inputClass} text-lg font-semibold`}
          />
          {qtyText && !valid && (
            <span className="mt-1 block text-xs text-pos-danger">
              {item.unit === 'KG'
                ? 'Escribe una cantidad mayor a 0.'
                : 'Se vende por pieza: escribe un número entero mayor a 0.'}
            </span>
          )}
          {valid && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Quedarán {formatStock(item.stock + qty, item.unit)}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nota (opcional)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={120}
            placeholder="Ej. Proveedor, factura o remisión"
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={!valid || saving} className={primaryButton}>
          {saving ? 'Guardando…' : 'Registrar entrada'}
        </button>
      </form>
    </Modal>
  )
}

/** Conteo físico: lo que hay de verdad en el anaquel. */
export function AjusteModal({
  item,
  onClose,
  onDone
}: {
  item: InventoryItem
  onClose: () => void
  onDone: (item: InventoryItem) => void
}): React.JSX.Element {
  const [countText, setCountText] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const counted = parseQty(countText)
  const valid = validQty(counted, item.unit, true)
  const diff = valid ? Math.round((counted - item.stock) * 1000) / 1000 : 0

  async function save(): Promise<void> {
    if (!valid) return
    setSaving(true)
    try {
      const updated = await ajustarExistencia(item.id, { counted, reason: reason.trim() })
      toast.success(`Existencia ajustada · ${item.name}: ${formatStock(updated.stock, item.unit)}`)
      onDone(updated)
    } catch (err) {
      toast.error(errorMessage(err, 'No se pudo ajustar la existencia'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Contar existencia" onClose={onClose} busy={saving}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
          <p className="font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            El sistema dice: {formatStock(item.stock, item.unit)}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            ¿Cuánto hay de verdad? ({item.unit === 'KG' ? 'kg' : 'piezas'})
          </span>
          <input
            autoFocus
            inputMode="decimal"
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            placeholder={item.unit === 'KG' ? '0.000' : '0'}
            className={`${inputClass} text-lg font-semibold`}
          />
          {countText && !valid && (
            <span className="mt-1 block text-xs text-pos-danger">
              {item.unit === 'KG'
                ? 'Escribe una cantidad de 0 o más.'
                : 'Se vende por pieza: escribe un número entero.'}
            </span>
          )}
          {valid && (
            <span
              className={`mt-1 block text-xs ${
                diff === 0
                  ? 'text-muted-foreground'
                  : diff > 0
                    ? 'text-pos-success'
                    : 'text-pos-danger'
              }`}
            >
              {diff === 0
                ? 'Coincide con el sistema: no hay nada que ajustar.'
                : `${diff > 0 ? 'Sobran' : 'Faltan'} ${formatStock(Math.abs(diff), item.unit)}`}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Motivo (opcional)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={120}
            placeholder="Ej. Conteo mensual, merma, producto dañado"
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={!valid || saving} className={primaryButton}>
          {saving ? 'Guardando…' : 'Guardar conteo'}
        </button>
      </form>
    </Modal>
  )
}

const TYPE_LABEL: Record<StockMovementType, string> = {
  ENTRY: 'Entrada',
  ADJUST: 'Ajuste',
  SALE: 'Venta'
}

/** Historial de movimientos de un producto. */
export function MovimientosModal({
  item,
  onClose
}: {
  item: InventoryItem
  onClose: () => void
}): React.JSX.Element {
  const [rows, setRows] = useState<StockMovement[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getMovimientosInventario(item.id)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [item.id])

  return (
    <Modal title={`Movimientos · ${item.name}`} onClose={onClose}>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-secondary text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2">Qué</th>
                <th className="px-3 py-2 text-right">Cambio</th>
                <th className="px-3 py-2 text-right">Quedó</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-1.5">
                    <p className="font-medium">
                      {TYPE_LABEL[m.type]}
                      {m.ticketNumber != null && (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          · ticket #{m.ticketNumber}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateTime(m.createdAt)} · {m.userName}
                      {m.reason ? ` · ${m.reason}` : ''}
                    </p>
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                      m.quantity >= 0 ? 'text-pos-success' : 'text-pos-danger'
                    }`}
                  >
                    {m.quantity > 0 ? '+' : ''}
                    {formatStock(m.quantity, item.unit)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatStock(m.stockAfter, item.unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

/** Elegir productos del catálogo para empezar a llevar su inventario (arrancan en 0). */
export function ActivarInventarioModal({
  onClose,
  onDone
}: {
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const [products, setProducts] = useState<ProductWithCategory[] | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    listProductosAdmin()
      .then((all) => {
        if (cancelled) return
        // Los de precio libre ("Varios") no son mercancía: no tiene sentido contarlos.
        setProducts(all.filter((p) => p.active === 1 && p.trackStock === 0 && p.openPrice === 0))
      })
      .catch(() => !cancelled && setProducts([]))
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (products ?? []).filter(
      (p) =>
        term === '' ||
        p.name.toLowerCase().includes(term) ||
        p.barcode === search.trim() ||
        (p.categoryName ?? '').toLowerCase().includes(term)
    )
  }, [products, search])

  const allVisiblePicked = visible.length > 0 && visible.every((p) => picked.has(p.id))

  function toggle(id: number): void {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleVisible(): void {
    setPicked((prev) => {
      const next = new Set(prev)
      for (const p of visible) {
        if (allVisiblePicked) next.delete(p.id)
        else next.add(p.id)
      }
      return next
    })
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const { enabled } = await activarInventario([...picked])
      toast.success(
        `${enabled} ${enabled === 1 ? 'producto agregado' : 'productos agregados'} al inventario. Ahora cuenta cuántos hay de cada uno.`
      )
      onDone()
    } catch (err) {
      toast.error(errorMessage(err, 'No se pudieron agregar'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Agregar productos al inventario" onClose={onClose} busy={saving}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Marca los productos de los que quieres llevar existencias. Entran en 0: después toca{' '}
          <strong>Contar</strong> en cada uno para poner lo que hay.
        </p>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, categoría o código…"
          className={inputClass}
        />
        {products === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todos tus productos ya llevan inventario.</p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={allVisiblePicked} onChange={toggleVisible} />
              Marcar {search.trim() ? 'los que se ven' : 'todos'} ({visible.length})
            </label>
            <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {visible.slice(0, 500).map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary/50">
                    <input
                      type="checkbox"
                      checked={picked.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {p.categoryName ?? ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {visible.length > 500 && (
              <p className="text-xs text-muted-foreground">
                Se muestran 500 de {visible.length}: busca para acotar (o usa &quot;Marcar
                todos&quot;).
              </p>
            )}
          </>
        )}
        <button
          onClick={() => void save()}
          disabled={picked.size === 0 || saving}
          className={primaryButton}
        >
          {saving
            ? 'Guardando…'
            : picked.size === 0
              ? 'Marca al menos uno'
              : `Llevar inventario de ${picked.size}`}
        </button>
      </div>
    </Modal>
  )
}
