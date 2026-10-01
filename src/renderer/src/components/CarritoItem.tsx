import { useState } from 'react'
import { MessageSquareText, Minus, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import type { CartItem } from '@/stores/cart.store'
import { money } from '@/lib/format'

/** Pesos de apoyo para cargar rápido cantidades comunes de productos por kg. */
const QUICK_GRAMS = [100, 250, 500, 1000]

/** Mismo tope que acepta el servidor por renglón. */
const MAX_PIECES = 9999

export function CarritoItem({
  item,
  onQty,
  onPrice,
  onRemove,
  onNote
}: {
  item: CartItem
  onQty: (key: string, quantity: number) => void
  onPrice: (key: string, price: number) => void
  onRemove: (key: string) => void
  /** Nota para quien despacha ("sin chile"); no aplica a precio libre (su nota es el nombre). */
  onNote?: (key: string, note: string) => void
}): React.JSX.Element {
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState(item.note ?? '')
  const canNote = !!onNote && !item.openPrice

  function commitNote(): void {
    setEditingNote(false)
    if (noteDraft.trim() !== (item.note ?? '')) onNote?.(item.key, noteDraft)
  }
  // En precio libre no hay precio de catálogo contra el cual marcar un descuento.
  const edited = !item.openPrice && item.price !== item.originalPrice
  const isKg = item.unit === 'KG'
  const grams = Math.round(item.quantity * 1000)

  // El draft se resincroniza con la fuente de verdad cuando ésta cambia desde afuera
  // (ej. Vaciar o quitar el ítem), sin useEffect — es el patrón recomendado por React
  // para "ajustar estado cuando cambia una prop" en el propio render.
  const [lastPrice, setLastPrice] = useState(item.price)
  const [priceDraft, setPriceDraft] = useState(String(item.price))
  if (item.price !== lastPrice) {
    setLastPrice(item.price)
    setPriceDraft(String(item.price))
  }

  function commitPrice(): void {
    const value = Number(priceDraft)
    // Sólo se permite descuento: el servidor rechaza un precio mayor al de catálogo, así que
    // se avisa aquí en vez de dejarlo en verde (como si fuera descuento) hasta cobrar.
    if (!item.openPrice && Number.isFinite(value) && value > item.originalPrice) {
      toast.error(`El precio no puede ser mayor al de catálogo (${money(item.originalPrice)}).`)
      setPriceDraft(String(item.price))
    } else if (Number.isFinite(value) && value > 0) {
      onPrice(item.key, Math.round((value + Number.EPSILON) * 100) / 100)
    } else {
      setPriceDraft(String(item.price))
    }
  }

  // Cantidad en gramos para productos que se venden por peso (item.quantity está en kg).
  const [lastGrams, setLastGrams] = useState(grams)
  const [gramsDraft, setGramsDraft] = useState(String(grams))
  if (grams !== lastGrams) {
    setLastGrams(grams)
    setGramsDraft(String(grams))
  }

  function commitGrams(): void {
    const value = Number(gramsDraft)
    if (Number.isFinite(value) && value > 0) {
      onQty(item.key, Math.round((value / 1000 + Number.EPSILON) * 1000) / 1000)
    } else {
      setGramsDraft(String(grams))
    }
  }

  function pickGrams(g: number): void {
    setGramsDraft(String(g))
    onQty(item.key, g / 1000)
  }

  // Piezas escritas a mano (50 copias sin picar 50 veces el +).
  const [lastQty, setLastQty] = useState(item.quantity)
  const [qtyDraft, setQtyDraft] = useState(String(item.quantity))
  if (item.quantity !== lastQty) {
    setLastQty(item.quantity)
    setQtyDraft(String(item.quantity))
  }

  function commitQty(): void {
    const value = Number(qtyDraft)
    if (Number.isInteger(value) && value >= 1 && value <= MAX_PIECES) {
      onQty(item.key, value)
    } else {
      if (Number.isInteger(value) && value > MAX_PIECES) {
        toast.error(`La cantidad máxima por renglón es ${MAX_PIECES.toLocaleString('es-MX')}.`)
      }
      setQtyDraft(String(item.quantity))
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-border py-2">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium break-words" title={item.name}>
          {item.name}
        </p>

        <div className="mt-0.5 flex items-center gap-1.5">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={priceDraft}
            onChange={(e) => setPriceDraft(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            title={item.openPrice ? 'Importe (precio libre)' : 'Precio de esta línea (editable)'}
            className={`w-20 rounded border border-input bg-background px-1.5 py-0.5 text-xs outline-none focus:border-ring ${
              edited ? 'font-semibold text-pos-success' : ''
            }`}
          />
          <span className="text-xs text-muted-foreground">{isKg ? 'c/kg' : 'c/u'}</span>
          {edited && (
            <span className="text-xs text-muted-foreground/60 line-through">
              {money(item.originalPrice)}
            </span>
          )}
        </div>

        {canNote && editingNote && (
          <input
            autoFocus
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setNoteDraft(item.note ?? '')
                setEditingNote(false)
              }
            }}
            maxLength={60}
            placeholder="Ej. sin chile, bien dorado"
            className="mt-1 w-full rounded border border-input bg-background px-1.5 py-0.5 text-xs outline-none focus:border-ring"
          />
        )}
        {canNote && !editingNote && (
          // En su propio renglón: junto al precio no cabe en el carrito angosto.
          <button
            type="button"
            onClick={() => {
              setNoteDraft(item.note ?? '')
              setEditingNote(true)
            }}
            title="Nota para quien despacha (sale en el ticket)"
            aria-label={item.note ? `Editar nota: ${item.note}` : 'Agregar nota'}
            className={`mt-0.5 inline-flex max-w-full items-start gap-1 rounded px-1 py-0.5 text-left text-[11px] transition hover:bg-secondary ${
              item.note ? 'text-pos-warning italic' : 'text-muted-foreground'
            }`}
          >
            <MessageSquareText size={12} className="shrink-0" />
            <span className="line-clamp-2 break-words">{item.note ?? '+ Nota'}</span>
          </button>
        )}

        {isKg && (
          <div className="mt-1 flex flex-wrap gap-1">
            {QUICK_GRAMS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => pickGrams(g)}
                className={`rounded border px-1.5 py-0.5 text-[11px] font-medium transition ${
                  grams === g
                    ? 'border-ring bg-secondary text-foreground'
                    : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                {g < 1000 ? `${g} g` : `${g / 1000} kg`}
              </button>
            ))}
          </div>
        )}
      </div>

      {isKg ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="1"
            step="1"
            value={gramsDraft}
            onChange={(e) => setGramsDraft(e.target.value)}
            onBlur={commitGrams}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            title="Cantidad en gramos (editable)"
            className="w-16 rounded border border-input bg-background px-1.5 py-1 text-center text-sm font-semibold outline-none focus:border-ring"
          />
          <span className="text-xs text-muted-foreground">g</span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onQty(item.key, item.quantity - 1)}
            className="grid h-7 w-7 place-items-center rounded-md border border-border transition hover:bg-secondary"
            aria-label="Quitar uno"
          >
            <Minus size={13} />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={qtyDraft}
            onChange={(e) => setQtyDraft(e.target.value)}
            onBlur={commitQty}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            title="Cantidad (escríbela o usa − / +)"
            aria-label="Cantidad"
            className="w-11 [appearance:textfield] rounded border border-input bg-background px-1 py-1 text-center text-sm font-semibold outline-none focus:border-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            onClick={() => onQty(item.key, Math.min(MAX_PIECES, item.quantity + 1))}
            className="grid h-7 w-7 place-items-center rounded-md border border-border transition hover:bg-secondary"
            aria-label="Agregar uno"
          >
            <Plus size={13} />
          </button>
        </div>
      )}

      <span className="w-16 text-right text-sm font-bold">{money(item.price * item.quantity)}</span>

      <button
        onClick={() => onRemove(item.key)}
        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-pos-danger/15 hover:text-pos-danger"
        aria-label="Quitar del carrito"
      >
        <X size={14} />
      </button>
    </div>
  )
}
