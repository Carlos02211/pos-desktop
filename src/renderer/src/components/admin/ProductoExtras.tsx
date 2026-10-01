import { Plus, X } from 'lucide-react'
import type { ProductWithCategory } from '@shared/types'
import type { ComponentDraft, OptionDraft } from '@/lib/producto-extras'
import { randomId } from '@/lib/utils'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

/**
 * Opciones a elegir al vender ("Tipo de pollo": Natural / Adobado / Al carbón +$10). De cada
 * grupo el cajero elige una, obligatoria.
 */
export function OpcionesEditor({
  drafts,
  onChange
}: {
  drafts: OptionDraft[]
  onChange: (drafts: OptionDraft[]) => void
}): React.JSX.Element {
  const update = (key: string, patch: Partial<OptionDraft>): void =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  const lastGroup = drafts.at(-1)?.groupName ?? ''

  return (
    <div className="space-y-2">
      {drafts.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_4.5rem_1.75rem] gap-1.5 text-xs text-muted-foreground">
          <span>Grupo</span>
          <span>Opción</span>
          <span>+ precio</span>
          <span />
        </div>
      )}
      {drafts.map((d) => (
        <div key={d.key} className="grid grid-cols-[1fr_1fr_4.5rem_1.75rem] gap-1.5">
          <input
            value={d.groupName}
            onChange={(e) => update(d.key, { groupName: e.target.value })}
            placeholder="Tipo de pollo"
            maxLength={40}
            className={inputClass}
          />
          <input
            value={d.name}
            onChange={(e) => update(d.key, { name: e.target.value })}
            placeholder="Adobado"
            maxLength={40}
            className={inputClass}
          />
          <input
            inputMode="decimal"
            value={d.priceText}
            onChange={(e) => update(d.key, { priceText: e.target.value })}
            placeholder="0"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
            className="grid place-items-center rounded-md text-muted-foreground transition hover:bg-pos-danger/15 hover:text-pos-danger"
            aria-label="Quitar opción"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...drafts, { key: randomId(), groupName: lastGroup, name: '', priceText: '' }])
        }
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:bg-secondary"
      >
        <Plus size={13} /> Agregar opción
      </button>
    </div>
  )
}

/**
 * Lo que lleva un paquete o presentación, para descontar inventario ("Medio pollo" = 0.5 de
 * "Pollo"). Sólo productos que no son paquetes.
 */
export function ContenidoEditor({
  drafts,
  onChange,
  products,
  selfId
}: {
  drafts: ComponentDraft[]
  onChange: (drafts: ComponentDraft[]) => void
  products: ProductWithCategory[]
  selfId: number | null
}): React.JSX.Element {
  const update = (key: string, patch: Partial<ComponentDraft>): void =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  const choices = products
    .filter((p) => p.id !== selfId && p.components.length === 0 && p.openPrice === 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-2">
      {drafts.map((d) => {
        const unit = products.find((p) => p.id === d.componentId)?.unit
        return (
          <div key={d.key} className="grid grid-cols-[1fr_5rem_1.75rem] items-center gap-1.5">
            <select
              value={d.componentId ?? ''}
              onChange={(e) =>
                update(d.key, { componentId: e.target.value ? Number(e.target.value) : null })
              }
              className={inputClass}
            >
              <option value="">Elige un producto…</option>
              {choices.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  disabled={p.id !== d.componentId && drafts.some((x) => x.componentId === p.id)}
                >
                  {p.name}
                  {p.trackStock ? '' : ' (sin inventario)'}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <input
                inputMode="decimal"
                value={d.qtyText}
                onChange={(e) => update(d.key, { qtyText: e.target.value })}
                placeholder="1"
                title="Cuánto lleva (0.5 = la mitad)"
                className={inputClass}
              />
              <span className="text-xs text-muted-foreground">{unit === 'KG' ? 'kg' : 'pz'}</span>
            </div>
            <button
              type="button"
              onClick={() => onChange(drafts.filter((x) => x.key !== d.key))}
              className="grid place-items-center rounded-md text-muted-foreground transition hover:bg-pos-danger/15 hover:text-pos-danger"
              aria-label="Quitar del contenido"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...drafts, { key: randomId(), componentId: null, qtyText: '1' }])}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:bg-secondary"
      >
        <Plus size={13} /> Agregar producto
      </button>
    </div>
  )
}
