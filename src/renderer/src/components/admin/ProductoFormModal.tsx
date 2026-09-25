import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Category, ProductWithCategory } from '@shared/types'
import { API_BASE_URL, ApiRequestError } from '@/api/client'
import { actualizarProducto, crearProducto, subirImagenProducto } from '@/api/admin'
import { Modal } from '@/components/Modal'

export function ProductoFormModal({
  product,
  categories,
  onClose,
  onSaved
}: {
  product: ProductWithCategory | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [name, setName] = useState(product?.name ?? '')
  const [priceText, setPriceText] = useState(product ? String(product.price) : '')
  const [unit, setUnit] = useState<'PIEZA' | 'KG'>(product?.unit ?? 'PIEZA')
  const [categoryId, setCategoryId] = useState<number | null>(product?.categoryId ?? null)
  const [active, setActive] = useState(product ? product.active === 1 : true)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const price = Number.parseFloat(priceText.replace(',', '.'))
  const valid = name.trim().length > 0 && Number.isFinite(price) && price >= 0

  // Un solo object URL por archivo seleccionado; se libera al cambiarlo o cerrar.
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl)
    }
  }, [fileUrl])

  const preview =
    fileUrl ?? (product?.imagePath ? `${API_BASE_URL}/uploads/${product.imagePath}` : null)

  async function save(): Promise<void> {
    setError('')
    setSaving(true)
    try {
      const payload = { name: name.trim(), price, unit, categoryId, active }
      const saved = product
        ? await actualizarProducto(product.id, payload)
        : await crearProducto(payload)
      if (file) await subirImagenProducto(saved.id, file)
      toast.success(product ? 'Producto actualizado' : 'Producto creado')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nombre</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Precio</span>
            <input
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Se vende por</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as 'PIEZA' | 'KG')}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            >
              <option value="PIEZA">Pieza (cantidad entera)</option>
              <option value="KG">Peso — precio por kg (admite gramos)</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Categoría</span>
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          >
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1 block text-sm font-medium">Imagen</span>
          <div className="flex items-center gap-3">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/40 text-xs text-muted-foreground">
              {preview ? (
                <img src={preview} alt="" className="h-full w-full object-cover" />
              ) : (
                'Sin img'
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activo (aparece en el panel del cobrador)
        </label>

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          onClick={() => void save()}
          disabled={saving || !valid}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
