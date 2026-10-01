import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AddToSaleResponse } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { agregarAVenta } from '@/api/ventas'
import { Modal } from '@/components/Modal'
import { money, paymentLabel } from '@/lib/format'
import { randomId } from '@/lib/utils'
import { type AppendTarget, useCartStore } from '@/stores/cart.store'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

/** Montos sugeridos: el exacto y los siguientes billetes redondos. */
function quickAmounts(total: number): number[] {
  const rounded = Math.ceil(total / 100) * 100 || 100
  const options = new Set<number>([total, rounded, rounded + 100, rounded + 400])
  return [...options].filter((n) => n >= total).sort((a, b) => a - b)
}

/**
 * Cobra lo que el cliente olvidó y lo suma a una venta ya cobrada (mismo folio). El método de
 * pago es el de la venta: así los cortes y reportes siguen cuadrando sin pagos mezclados.
 */
export function AgregarCobroModal({
  target,
  added,
  onClose,
  onDone
}: {
  target: AppendTarget
  /** Importe de lo que se agrega (el carrito). */
  added: number
  onClose: () => void
  onDone: (sale: AddToSaleResponse) => void
}): React.JSX.Element {
  const items = useCartStore((s) => s.items)
  // Un id por apertura: un doble clic o un reintento no agrega los productos dos veces.
  const [clientRequestId] = useState(() => randomId())
  const [paidText, setPaidText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const cash = target.paymentMethod === 'CASH'
  const paid = Number.parseFloat(paidText.replace(',', '.'))
  const cashShort = cash && (!Number.isFinite(paid) || paid < added)
  const change = useMemo(
    () => (cash && Number.isFinite(paid) ? Math.round((paid - added) * 100) / 100 : null),
    [cash, paid, added]
  )
  const newTotal = Math.round((target.total + added) * 100) / 100

  async function confirm(): Promise<void> {
    setError('')
    setSubmitting(true)
    try {
      const sale = await agregarAVenta(target.saleId, {
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          // Precio libre: el importe siempre lo pone el cajero.
          price: i.openPrice || i.price !== i.originalPrice ? i.price : undefined,
          note: i.note
        })),
        amountPaid: cash ? paid : undefined,
        clientRequestId
      })
      onDone(sale)
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : 'No se pudieron agregar los productos'
      setError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Agregar a la venta #${target.ticketNumber}`} onClose={onClose} busy={submitting}>
      <div className="space-y-4">
        <div className="space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Venta #{target.ticketNumber}</span>
            <span>{money(target.total)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Se agrega</span>
            <span className="text-2xl font-bold">{money(added)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <span>Nuevo total</span>
            <span>{money(newTotal)}</span>
          </div>
        </div>

        <p className="text-sm">
          Método: <strong>{paymentLabel(target.paymentMethod)}</strong>
          <span className="text-muted-foreground"> (el mismo de la venta)</span>
        </p>

        {cash && (
          <div className="space-y-2">
            <label className="block text-sm font-medium">Monto recibido por lo agregado</label>
            <input
              autoFocus
              inputMode="decimal"
              value={paidText}
              onChange={(e) => setPaidText(e.target.value)}
              placeholder={added.toFixed(2)}
              className={inputClass}
            />
            <div className="flex flex-wrap gap-1.5">
              {quickAmounts(added).map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setPaidText(String(amount))}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition hover:bg-secondary"
                >
                  {amount === added ? 'Exacto' : money(amount)}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cambio</span>
              <span className={cashShort ? 'text-pos-danger' : 'font-semibold text-pos-success'}>
                {change === null || cashShort ? '—' : money(change)}
              </span>
            </div>
          </div>
        )}
        {target.paymentMethod === 'CREDIT' && (
          <p className="rounded-lg bg-pos-warning/15 px-3 py-2 text-sm">
            Se suma a lo que debe {target.customerName ?? 'el cliente'}.
          </p>
        )}
        {(target.paymentMethod === 'CARD' || target.paymentMethod === 'TRANSFER') && (
          <p className="rounded-lg bg-secondary/50 px-3 py-2 text-sm">
            Cobra {money(added)} por {paymentLabel(target.paymentMethod).toLowerCase()} antes de
            confirmar.
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          onClick={() => void confirm()}
          disabled={submitting || cashShort}
          className="w-full rounded-lg bg-pos-success px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Agregando…' : `Agregar a la venta #${target.ticketNumber}`}
        </button>
      </div>
    </Modal>
  )
}
