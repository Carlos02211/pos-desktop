import type { ProductOptionInput, ProductWithCategory } from '@shared/types'

/** Borradores del formulario de producto para opciones y contenido de paquete. */

/** Renglón editable de una opción; `price` como texto mientras se escribe. */
export interface OptionDraft {
  key: string
  id?: number
  groupName: string
  name: string
  priceText: string
}

export interface ComponentDraft {
  key: string
  componentId: number | null
  qtyText: string
}

export function optionDrafts(product: ProductWithCategory | null): OptionDraft[] {
  return (product?.options ?? []).map((o) => ({
    key: String(o.id),
    id: o.id,
    groupName: o.groupName,
    name: o.name,
    priceText: o.price ? String(o.price) : ''
  }))
}

export function componentDrafts(product: ProductWithCategory | null): ComponentDraft[] {
  return (product?.components ?? []).map((c) => ({
    key: String(c.componentId),
    componentId: c.componentId,
    qtyText: String(c.quantity)
  }))
}

function num(text: string): number {
  return text.trim() === '' ? 0 : Number.parseFloat(text.replace(',', '.'))
}

/** Opciones listas para mandar, o null si alguna está incompleta. */
export function optionsPayload(drafts: OptionDraft[]): ProductOptionInput[] | null {
  const out: ProductOptionInput[] = []
  for (const d of drafts) {
    const price = num(d.priceText)
    if (!d.groupName.trim() || !d.name.trim() || !Number.isFinite(price) || price < 0) return null
    out.push({
      ...(d.id != null ? { id: d.id } : {}),
      groupName: d.groupName.trim(),
      name: d.name.trim(),
      price
    })
  }
  return out
}

export function componentsPayload(
  drafts: ComponentDraft[]
): { componentId: number; quantity: number }[] | null {
  const out: { componentId: number; quantity: number }[] = []
  for (const d of drafts) {
    const quantity = num(d.qtyText)
    if (d.componentId == null || !Number.isFinite(quantity) || quantity <= 0) return null
    out.push({ componentId: d.componentId, quantity })
  }
  return out
}
