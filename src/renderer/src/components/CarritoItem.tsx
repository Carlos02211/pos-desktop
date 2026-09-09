import { useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import type { CartItem } from '@/stores/cart.store'
import { money } from '@/lib/format'

/** Pesos de apoyo para cargar rápido cantidades comunes de productos por kg. */
const QUICK_GRAMS = [100, 250, 500, 1000]

export function CarritoItem({
  item,
  onQty,
  onPrice,
  onRemove
}: {
  item: CartItem
  onQty: (productId: number, quantity: number) => void
  onPrice: (productId: number, price: number) => void
  onRemove: (productId: number) => void
}): React.JSX.Element {
  const edited = item.price !== item.originalPrice
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
    if (Number.isFinite(value) && value > 0) {
      onPrice(item.productId, Math.round((value + Number.EPSILON) * 100) / 100)
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
      onQty(item.productId, Math.round((value / 1000 + Number.EPSILON) * 1000) / 1000)
    } else {
      setGramsDraft(String(grams))
    }
  }

  function pickGrams(g: number): void {
    setGramsDraft(String(g))
    onQty(item.productId, g / 1000)
  }

  return (
    <div className="flex items-center gap-2 border-b border-border py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>

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
            title="Precio de esta línea (editable)"
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
            onClick={() => onQty(item.productId, item.quantity - 1)}
            className="grid h-7 w-7 place-items-center rounded-md border border-border transition hover:bg-secondary"
            aria-label="Quitar uno"
          >
            <Minus size={13} />
          </button>
          <span className="w-7 text-center text-sm font-semibold">{item.quantity}</span>
          <button
            onClick={() => onQty(item.productId, item.quantity + 1)}
            className="grid h-7 w-7 place-items-center rounded-md border border-border transition hover:bg-secondary"
            aria-label="Agregar uno"
          >
            <Plus size={13} />
          </button>
        </div>
      )}

      <span className="w-16 text-right text-sm font-bold">{money(item.price * item.quantity)}</span>

      <button
        onClick={() => onRemove(item.productId)}
        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-pos-danger/15 hover:text-pos-danger"
        aria-label="Quitar del carrito"
      >
        <X size={14} />
      </button>
    </div>
  )
}
