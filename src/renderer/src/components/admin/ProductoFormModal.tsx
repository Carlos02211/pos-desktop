import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { BarcodeLookup, Category, ProductWithCategory } from '@shared/types'
import { API_BASE_URL, ApiRequestError } from '@/api/client'
import { Loader2, Sparkles } from 'lucide-react'
import {
  actualizarProducto,
  buscarDatosPorCodigo,
  crearCategoria,
  crearProducto,
  subirImagenProducto
} from '@/api/admin'
import { Modal } from '@/components/Modal'

/** Categoría sugerida que todavía no existe: se crea al guardar. */
const NEW_CATEGORY = -1

/** Sólo se buscan datos de códigos EAN/UPC (8 a 14 dígitos). */
const LOOKUP_RE = /^\d{8,14}$/

export function ProductoFormModal({
  product,
  categories,
  initialBarcode,
  onClose,
  onSaved
}: {
  product: ProductWithCategory | null
  categories: Category[]
  /** Alta desde el lector: el código escaneado que no estaba registrado. */
  initialBarcode?: string
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [name, setName] = useState(product?.name ?? '')
  const [priceText, setPriceText] = useState(product ? String(product.price) : '')
  const [unit, setUnit] = useState<'PIEZA' | 'KG'>(product?.unit ?? 'PIEZA')
  const [categoryId, setCategoryId] = useState<number | null>(product?.categoryId ?? null)
  const [barcode, setBarcode] = useState(product?.barcode ?? initialBarcode ?? '')
  const initialLookup = !product && !!initialBarcode && LOOKUP_RE.test(initialBarcode)
  const [newCategory, setNewCategory] = useState('')
  const [lookup, setLookup] = useState<{
    state: 'idle' | 'loading' | 'found' | 'none'
    source?: string
  }>({ state: initialLookup ? 'loading' : 'idle' })
  const lookedUp = useRef<string | null>(null)
  const [active, setActive] = useState(product ? product.active === 1 : true)
  const [openPrice, setOpenPrice] = useState(product?.openPrice === 1)
  const wasTracked = product?.trackStock === 1
  const [trackStock, setTrackStock] = useState(wasTracked)
  const [initialStockText, setInitialStockText] = useState('')
  const [minStockText, setMinStockText] = useState(
    product?.minStock == null ? '' : String(product.minStock)
  )
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * Sólo al dar de alta: busca el código en el catálogo base (y en internet, si el servidor
   * tiene) y llena lo que esté vacío. Nunca pisa lo que el admin ya escribió.
   */
  async function lookupCode(code: string): Promise<void> {
    if (product || !LOOKUP_RE.test(code) || lookedUp.current === code) return
    lookedUp.current = code
    setLookup({ state: 'loading' })
    try {
      applyLookup(code, await buscarDatosPorCodigo(code))
    } catch {
      setLookup({ state: 'none' })
    }
  }

  function applyLookup(code: string, found: BarcodeLookup | null): void {
    if (lookedUp.current !== code) return // el admin ya escaneó otro
    if (!found) {
      setLookup({ state: 'none' })
      return
    }
    setName((n) => n.trim() || found.item.name)
    setUnit(found.item.unit)
    if (categoryId == null) {
      const match = categories.find(
        (c) => c.name.trim().toLowerCase() === found.item.category.trim().toLowerCase()
      )
      if (match) setCategoryId(match.id)
      else {
        setNewCategory(found.item.category)
        setCategoryId(NEW_CATEGORY)
      }
    }
    setLookup({
      state: 'found',
      source:
        found.source === 'catalogo' ? 'del catálogo de abarrotes' : 'de Open Food Facts (internet)'
    })
  }

  // Escaneado desde la lista de productos: buscar sus datos al abrir (el estado inicial ya
  // dice "buscando…"; aquí sólo se cambia al llegar la respuesta).
  useEffect(() => {
    if (!initialLookup) return
    lookedUp.current = initialBarcode!
    buscarDatosPorCodigo(initialBarcode!)
      .then((found) => applyLookup(initialBarcode!, found))
      .catch(() => setLookup({ state: 'none' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
  }, [])

  // En precio libre el precio es sólo una sugerencia: vacío = 0.
  const price =
    openPrice && priceText.trim() === '' ? 0 : Number.parseFloat(priceText.replace(',', '.'))
  const initialStock =
    initialStockText.trim() === ''
      ? undefined
      : Number.parseFloat(initialStockText.replace(',', '.'))
  const minStock =
    minStockText.trim() === '' ? null : Number.parseFloat(minStockText.replace(',', '.'))
  const stockValid =
    !trackStock ||
    ((initialStock === undefined ||
      (Number.isFinite(initialStock) &&
        initialStock >= 0 &&
        (unit === 'KG' || Number.isInteger(initialStock)))) &&
      (minStock === null || (Number.isFinite(minStock) && minStock >= 0)))
  const valid = name.trim().length > 0 && Number.isFinite(price) && price >= 0 && stockValid

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
      let catId = categoryId
      if (catId === NEW_CATEGORY) {
        // La categoría sugerida puede haberse creado mientras tanto (otra pestaña).
        const existing = categories.find(
          (c) => c.name.trim().toLowerCase() === newCategory.trim().toLowerCase()
        )
        catId = existing ? existing.id : (await crearCategoria({ name: newCategory.trim() })).id
      }
      const payload = {
        name: name.trim(),
        price,
        unit,
        categoryId: catId,
        barcode: barcode.trim(),
        openPrice,
        trackStock,
        ...(trackStock ? { minStock } : {}),
        ...(trackStock && !wasTracked && initialStock !== undefined ? { initialStock } : {}),
        active
      }
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
            // Alta nueva: el foco va al código (si se escanea en el nombre, el código acabaría ahí).
            autoFocus={!!product || !!initialBarcode}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              {openPrice ? 'Precio sugerido (opcional)' : 'Precio'}
            </span>
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

        <label className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={openPrice}
            onChange={(e) => setOpenPrice(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Precio libre</span>
            <span className="block text-xs text-muted-foreground">
              El cajero escribe el importe al cobrar y, si quiere, qué fue (ej. Varios, engargolado,
              impresión especial). Sin tope de precio ni límite de descuento.
            </span>
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Código de barras (opcional)</span>
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value.replace(/\s/g, ''))}
            // El lector termina con Enter: deja el código escrito y busca sus datos.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              void lookupCode(barcode)
            }}
            onBlur={() => void lookupCode(barcode)}
            placeholder="Escanéalo aquí o escríbelo"
            autoFocus={!product && !initialBarcode}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          {lookup.state === 'loading' && (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando datos del código…
            </span>
          )}
          {lookup.state === 'found' && (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-pos-success">
              <Sparkles className="h-3.5 w-3.5" /> Datos tomados {lookup.source}. Revisa el nombre y
              pon el precio.
            </span>
          )}
          {lookup.state === 'none' && (
            <span className="mt-1 block text-xs text-muted-foreground">
              No hay datos de este código: llena el nombre a mano.
            </span>
          )}
        </label>

        {!openPrice && (
          <div className="space-y-2 rounded-lg border border-border px-3 py-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={trackStock}
                onChange={(e) => setTrackStock(e.target.checked)}
              />
              Llevar inventario
            </label>
            {trackStock && (
              <div className="grid grid-cols-2 gap-3">
                {wasTracked ? (
                  <div className="text-sm">
                    <span className="mb-1 block font-medium">Existencia</span>
                    <span className="block py-2">
                      {product!.stock} {unit === 'KG' ? 'kg' : 'pz'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Se cambia en Inventario.
                    </span>
                  </div>
                ) : (
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">¿Cuántos hay?</span>
                    <input
                      inputMode="decimal"
                      value={initialStockText}
                      onChange={(e) => setInitialStockText(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Avisar al llegar a</span>
                  <input
                    inputMode="decimal"
                    value={minStockText}
                    onChange={(e) => setMinStockText(e.target.value)}
                    placeholder="Sin aviso"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                  />
                </label>
              </div>
            )}
            {trackStock && !stockValid && (
              <p className="text-xs text-pos-danger">
                Revisa las cantidades: sin negativos
                {unit === 'PIEZA' ? ' y en piezas enteras' : ''}.
              </p>
            )}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Categoría</span>
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          >
            <option value="">Sin categoría</option>
            {newCategory && (
              <option value={NEW_CATEGORY}>{newCategory} (nueva, se crea al guardar)</option>
            )}
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
