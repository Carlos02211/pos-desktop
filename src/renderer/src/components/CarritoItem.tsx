import { Minus, Plus, X } from 'lucide-react'
import type { CartItem } from '@/stores/cart.store'
import { money } from '@/lib/format'

export function CarritoItem({
  item,
  onQty,
  onRemove
}: {
  item: CartItem
  onQty: (productId: number, quantity: number) => void
  onRemove: (productId: number) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground">{money(item.price)} c/u</p>
      </div>

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
