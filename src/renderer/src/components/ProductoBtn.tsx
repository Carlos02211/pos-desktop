import type { ProductWithCategory } from '@shared/types'
import { API_BASE_URL } from '@/api/client'
import { money } from '@/lib/format'

/** Botón grande de producto (mínimo 120×120) para el grid del cobrador. */
export function ProductoBtn({
  product,
  onSelect
}: {
  product: ProductWithCategory
  onSelect: (product: ProductWithCategory) => void
}): React.JSX.Element {
  const imageUrl = product.imagePath ? `${API_BASE_URL}/uploads/${product.imagePath}` : null

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      className="flex min-h-[120px] flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-ring hover:brightness-110 active:scale-[0.98]"
    >
      <div className="flex flex-1 items-center justify-center bg-secondary/40">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="py-6 text-3xl font-bold text-muted-foreground">
            {product.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="line-clamp-2 text-sm font-medium">{product.name}</p>
        <p className="mt-0.5 text-sm font-bold text-pos-success">{money(product.price)}</p>
      </div>
    </button>
  )
}
