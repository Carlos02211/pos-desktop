import { useMemo, useState } from 'react'
import type { ProductOption, ProductWithCategory } from '@shared/types'
import { Modal } from '@/components/Modal'
import { money } from '@/lib/format'
import { withOptions } from '@/stores/cart.store'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

/**
 * Al vender un producto con opciones ("Pollo entero"): el cajero toca una de cada grupo
 * (Natural / Adobado / Al carbón) y, si quiere, una nota para quien despacha.
 */
export function OpcionesModal({
  product,
  onClose,
  onAdd
}: {
  product: ProductWithCategory
  onClose: () => void
  onAdd: (options: ProductOption[], note: string) => void
}): React.JSX.Element {
  const groups = useMemo(() => {
    const map = new Map<string, ProductOption[]>()
    for (const o of product.options) map.set(o.groupName, [...(map.get(o.groupName) ?? []), o])
    return [...map.entries()]
  }, [product.options])
  // Si un grupo tiene una sola opción, ya va elegida.
  const [picked, setPicked] = useState<Record<string, number>>(() =>
    Object.fromEntries(groups.filter(([, opts]) => opts.length === 1).map(([g, o]) => [g, o[0].id]))
  )
  const [note, setNote] = useState('')

  const chosen = product.options.filter((o) => picked[o.groupName] === o.id)
  const complete = groups.every(([g]) => picked[g] != null)
  const { price } = withOptions(product, chosen)

  function add(): void {
    if (complete) onAdd(chosen, note)
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
        {groups.map(([group, opts]) => (
          <fieldset key={group}>
            <legend className="mb-1.5 text-sm font-medium">{group}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {opts.map((o) => {
                const active = picked[group] === o.id
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setPicked((p) => ({ ...p, [group]: o.id }))}
                    aria-pressed={active}
                    className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold transition active:scale-[0.98] ${
                      active
                        ? 'border-ring bg-primary text-primary-foreground shadow-sm'
                        : 'border-input bg-secondary hover:brightness-125'
                    }`}
                  >
                    {o.name}
                    {o.price > 0 && (
                      <span className="block text-xs font-normal opacity-80">
                        +{money(o.price)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nota (opcional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={60}
            placeholder="Ej. sin chile, bien dorado, partido en piezas…"
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-muted-foreground">Sale en el ticket.</span>
        </label>

        <button
          type="submit"
          disabled={!complete}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {complete ? `Agregar · ${money(price)}` : 'Elige una opción de cada grupo'}
        </button>
      </form>
    </Modal>
  )
}
