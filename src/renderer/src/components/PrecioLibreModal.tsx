import { useState } from 'react'
import type { ProductWithCategory } from '@shared/types'
import { Modal } from '@/components/Modal'
import { money } from '@/lib/format'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

/** Mismo tope que acepta el servidor por precio de renglón. */
const MAX_AMOUNT = 1_000_000

/**
 * Cobro de un producto de precio libre ("Varios", engargolado, impresión especial…):
 * el cajero escribe el importe y, si quiere, qué fue. La descripción sale en el ticket.
 */
export function PrecioLibreModal({
  product,
  onClose,
  onAdd
}: {
  product: ProductWithCategory
  onClose: () => void
  onAdd: (price: number, note: string) => void
}): React.JSX.Element {
  const [amountText, setAmountText] = useState(product.price > 0 ? String(product.price) : '')
  const [note, setNote] = useState('')

  const amount = Number.parseFloat(amountText.replace(',', '.'))
  const valid = Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT

  function add(): void {
    if (!valid) return
    onAdd(Math.round((amount + Number.EPSILON) * 100) / 100, note.trim().replace(/\s+/g, ' '))
  }

  return (
    <Modal title={product.name} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Importe</span>
          <input
            autoFocus
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="0.00"
            className={`${inputClass} text-2xl font-bold tabular-nums`}
          />
          {product.price > 0 && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Precio sugerido: {money(product.price)}
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">¿Qué es? (opcional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={60}
            placeholder="Ej. Engargolado, impresión a color, tarea…"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-muted-foreground">Sale en el ticket.</span>
        </label>

        <button
          type="submit"
          disabled={!valid}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {valid ? `Agregar ${money(amount)}` : 'Agregar'}
        </button>
      </form>
    </Modal>
  )
}
