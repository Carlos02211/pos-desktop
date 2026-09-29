import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Loader2,
  PackageSearch,
  Upload
} from 'lucide-react'
import type {
  CatalogInfo,
  ImportProductItem,
  ImportProductsResult,
  ProductUnit
} from '@shared/types'
import { getCatalogo, importarProductos, leerArchivoImportacion, listCatalogos } from '@/api/admin'
import { ApiRequestError } from '@/api/client'
import { Modal } from '@/components/Modal'
import { actionButtonClass } from '@/components/admin/SettingsCard'
import { downloadFile } from '@/lib/download'

/** Renglón editable de la vista previa (de Excel o de un catálogo). */
interface Row {
  key: number
  selected: boolean
  name: string
  /** Texto tal cual lo escribe el admin ("20", "20.50"); se valida al importar. */
  price: string
  unit: ProductUnit
  category: string
  barcode: string
  /** Marca / presentación (sólo catálogo): ayudan a buscar. */
  extra: string
  /** Renglón de Excel que no se pudo leer: se muestra, pero no se puede importar. */
  error?: string
  /** Para buscar sin acentos. */
  search: string
}

type Source =
  { kind: 'excel'; fileName: string; withoutPrice: number } | { kind: 'catalog'; info: CatalogInfo }

const PAGE = 100

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function parsePrice(text: string): number | null {
  const t = text.replace(/[$\s,]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export default function ImportarProductos(): React.JSX.Element {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [catalogs, setCatalogs] = useState<CatalogInfo[]>([])
  const [source, setSource] = useState<Source | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearchRaw] = useState('')
  const [catFilter, setCatFilterRaw] = useState('')
  const [onlySelected, setOnlySelectedRaw] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  // Al cambiar un filtro se vuelve a mostrar desde el principio.
  const setSearch = (v: string): void => {
    setSearchRaw(v)
    setLimit(PAGE)
  }
  const setCatFilter = (v: string): void => {
    setCatFilterRaw(v)
    setLimit(PAGE)
  }
  const setOnlySelected = (v: boolean): void => {
    setOnlySelectedRaw(v)
    setLimit(PAGE)
  }
  const [review, setReview] = useState<{
    items: ImportProductItem[]
    result: ImportProductsResult
  } | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    listCatalogos()
      .then(setCatalogs)
      .catch(() => {})
  }, [])

  async function onFile(file: File): Promise<void> {
    setLoading(true)
    try {
      const { rows: parsed, withoutPrice } = await leerArchivoImportacion(file)
      if (parsed.length === 0) {
        toast.error(
          withoutPrice > 0
            ? `Ningún producto del archivo tiene precio (${withoutPrice.toLocaleString('es-MX')} sin precio). Llena la columna Precio de lo que vendes.`
            : 'El archivo no tiene productos debajo de los encabezados.'
        )
        return
      }
      setRows(
        parsed.map((r, i) => {
          const it = r.item
          const name = it?.name ?? ''
          return {
            key: i,
            selected: !r.error,
            name,
            price: it ? String(it.price) : '',
            unit: it?.unit ?? 'PIEZA',
            category: it?.category ?? '',
            barcode: it?.barcode ?? '',
            extra: `Renglón ${r.row}`,
            error: r.error ? `Renglón ${r.row}: ${r.error}` : undefined,
            search: fold(`${name} ${it?.category ?? ''} ${it?.barcode ?? ''}`)
          }
        })
      )
      setSource({ kind: 'excel', fileName: file.name, withoutPrice })
      resetFilters()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo leer el archivo')
    } finally {
      setLoading(false)
    }
  }

  async function onCatalog(info: CatalogInfo): Promise<void> {
    setLoading(true)
    try {
      const items = await getCatalogo(info.id)
      setRows(
        items.map((it, i) => {
          const extra = [it.brand, it.size].filter(Boolean).join(' · ')
          return {
            key: i,
            selected: false,
            name: it.name,
            price: '',
            unit: it.unit,
            category: it.category,
            barcode: it.barcode ?? '',
            extra,
            search: fold(`${it.name} ${extra} ${it.category} ${it.barcode ?? ''}`)
          }
        })
      )
      setSource({ kind: 'catalog', info })
      resetFilters()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo cargar el catálogo')
    } finally {
      setLoading(false)
    }
  }

  function resetFilters(): void {
    setSearch('')
    setCatFilter('')
    setOnlySelected(false)
  }

  function update(key: number, patch: Partial<Row>): void {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const categoryOptions = useMemo(
    () =>
      [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows]
  )

  const filtered = useMemo(() => {
    const terms = fold(search).split(/\s+/).filter(Boolean)
    return rows.filter(
      (r) =>
        (!onlySelected || r.selected) &&
        (!catFilter || r.category === catFilter) &&
        terms.every((t) => r.search.includes(t))
    )
  }, [rows, search, catFilter, onlySelected])

  const selected = rows.filter((r) => r.selected)
  // "Marcar todos": los que coinciden con la búsqueda/categoría (no sólo los 100 que se ven).
  const selectable = filtered.filter((r) => !r.error)
  const allMarked = selectable.length > 0 && selectable.every((r) => r.selected)
  const someMarked = !allMarked && selectable.some((r) => r.selected)

  function markAll(on: boolean): void {
    const keys = new Set(selectable.map((r) => r.key))
    setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, selected: on } : r)))
  }
  const missingPrice = selected.filter((r) => parsePrice(r.price) == null).length

  async function startImport(): Promise<void> {
    if (missingPrice > 0) {
      setOnlySelected(true)
      toast.error(`Falta el precio en ${missingPrice} producto(s) seleccionado(s).`)
      return
    }
    const items: ImportProductItem[] = selected.map((r) => ({
      name: r.name,
      price: parsePrice(r.price)!,
      unit: r.unit,
      category: r.category.trim() || null,
      barcode: r.barcode.trim() || null
    }))
    setImporting(true)
    try {
      const result = await importarProductos({ items, dryRun: true })
      setReview({ items, result })
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo revisar la lista')
    } finally {
      setImporting(false)
    }
  }

  async function confirmImport(): Promise<void> {
    if (!review) return
    setImporting(true)
    try {
      const result = await importarProductos({ items: review.items })
      toast.success(
        `${result.created} producto(s) importado(s)` +
          (result.skipped.length ? ` · ${result.skipped.length} omitido(s)` : '')
      )
      navigate('/admin/productos')
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo importar')
    } finally {
      setImporting(false)
    }
  }

  const inputCls =
    'w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50'

  return (
    <div className="pb-24">
      <Link
        to="/admin/productos"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Productos
      </Link>
      <h1 className="text-xl font-bold">Importar productos</h1>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Da de alta muchos productos de una vez: desde un Excel o eligiéndolos de un catálogo. Antes
        de guardar ves la lista, pones los precios y quitas lo que no vendes.
      </p>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Desde Excel
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Llena la plantilla (nombre, precio, unidad, categoría y código) y súbela. También acepta
            CSV.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void downloadFile('/api/productos/plantilla', {}).catch(() =>
                  toast.error('No se pudo descargar la plantilla')
                )
              }
              className={actionButtonClass}
            >
              <Download className="h-4 w-4" /> Descargar plantilla
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void onFile(f)
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" /> Subir archivo…
            </button>
          </div>
        </section>

        {catalogs.map((c) => (
          <section key={c.id} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <PackageSearch className="h-5 w-5 text-primary" /> {c.name}
            </div>
            <p className="mb-1 text-sm text-muted-foreground">{c.description}</p>
            <p className="mb-4 text-xs text-muted-foreground">
              {c.count.toLocaleString('es-MX')} productos · {c.source}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onCatalog(c)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                <PackageSearch className="h-4 w-4" /> Elegir aquí
              </button>
              <button
                type="button"
                onClick={() =>
                  void downloadFile(`/api/catalogos/${c.id}/excel`, {}).catch(() =>
                    toast.error('No se pudo descargar el catálogo')
                  )
                }
                title="Pon los precios en Excel y súbelo con “Subir archivo…”"
                className={actionButtonClass}
              >
                <Download className="h-4 w-4" /> Descargar en Excel
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Para muchos productos es más rápido en Excel: pon el precio de lo que vendes y súbelo
              en “Desde Excel”. Lo que quede sin precio no se importa.
            </p>
          </section>
        ))}
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      )}

      {source && !loading && (
        <>
          <h2 className="mb-1 text-lg font-semibold">
            {source.kind === 'excel' ? `Archivo: ${source.fileName}` : source.info.name}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {source.kind === 'catalog'
              ? 'Busca lo que vendes, márcalo y ponle precio. El nombre y la categoría se pueden cambiar.'
              : 'Revisa los productos del archivo. Quita la marca de los que no quieras importar.'}
            {source.kind === 'excel' && source.withoutPrice > 0 && (
              <>
                {' '}
                <strong>
                  {source.withoutPrice.toLocaleString('es-MX')} renglón(es) sin precio no se
                  importan.
                </strong>
              </>
            )}
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, marca o código…"
              className="w-72 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
            >
              <option value="">Todas las categorías</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlySelected}
                onChange={(e) => setOnlySelected(e.target.checked)}
                className="h-4 w-4"
              />
              Sólo los marcados ({selected.length})
            </label>
            {selectable.length > 0 && (
              <button
                type="button"
                onClick={() => markAll(!allMarked)}
                className="text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                {allMarked ? 'Desmarcar' : 'Marcar'} los {selectable.length.toLocaleString('es-MX')}{' '}
                que coinciden
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allMarked}
                      ref={(el) => {
                        if (el) el.indeterminate = someMarked
                      }}
                      onChange={(e) => markAll(e.target.checked)}
                      disabled={selectable.length === 0}
                      aria-label="Marcar todos los que coinciden con la búsqueda"
                      title="Marcar / desmarcar todos los que coinciden con la búsqueda"
                      className="h-4 w-4"
                    />
                  </th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="w-56 px-3 py-2">Categoría</th>
                  <th className="w-28 px-3 py-2">Unidad</th>
                  <th className="w-32 px-3 py-2">Precio</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Nada coincide con la búsqueda.
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, limit).map((r) => (
                    <tr
                      key={r.key}
                      className={`border-t border-border ${r.selected ? 'bg-primary/5' : ''} ${r.error ? 'bg-destructive/5' : ''}`}
                    >
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          disabled={!!r.error}
                          onChange={(e) => update(r.key, { selected: e.target.checked })}
                          aria-label={`Importar ${r.name}`}
                          className="mt-1.5 h-4 w-4"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {r.error ? (
                          <p className="flex items-start gap-1.5 text-destructive">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {r.error}
                          </p>
                        ) : (
                          <>
                            <input
                              value={r.name}
                              onChange={(e) => update(r.key, { name: e.target.value })}
                              className={inputCls}
                            />
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {[r.extra, r.barcode].filter(Boolean).join(' · ')}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input
                          value={r.category}
                          onChange={(e) => update(r.key, { category: e.target.value })}
                          disabled={!!r.error}
                          list="import-categorias"
                          className={inputCls}
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select
                          value={r.unit}
                          onChange={(e) => update(r.key, { unit: e.target.value as ProductUnit })}
                          disabled={!!r.error}
                          className={inputCls}
                        >
                          <option value="PIEZA">Pieza</option>
                          <option value="KG">Kg</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input
                          value={r.price}
                          inputMode="decimal"
                          placeholder="$0.00"
                          disabled={!!r.error}
                          onChange={(e) =>
                            // Escribir un precio marca el producto: es lo natural en el catálogo.
                            update(r.key, {
                              price: e.target.value,
                              selected: e.target.value.trim() ? true : r.selected
                            })
                          }
                          className={`${inputCls} ${r.selected && parsePrice(r.price) == null ? 'border-pos-warning' : ''}`}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <datalist id="import-categorias">
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {filtered.length > limit && (
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Mostrando {limit.toLocaleString('es-MX')} de{' '}
                {filtered.length.toLocaleString('es-MX')}. Busca para encontrar más rápido.
              </span>
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE)}
                className={actionButtonClass}
              >
                Mostrar más
              </button>
            </div>
          )}

          <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-5 py-3 shadow-lg backdrop-blur">
            <span className="text-sm">
              <strong>{selected.length}</strong> marcado(s)
              {missingPrice > 0 && (
                <span className="text-pos-warning"> · {missingPrice} sin precio</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => void startImport()}
              disabled={selected.length === 0 || importing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Revisar e importar
            </button>
          </div>
        </>
      )}

      {review && (
        <Modal title="Confirmar importación" onClose={() => setReview(null)} busy={importing}>
          <div className="space-y-3 text-sm">
            <p>
              Se van a dar de alta <strong>{review.result.created}</strong> producto(s).
            </p>
            {review.result.newCategories.length > 0 && (
              <p>
                Categorías nuevas: <strong>{review.result.newCategories.join(', ')}</strong>
              </p>
            )}
            {review.result.skipped.length > 0 && (
              <div>
                <p className="mb-1 font-medium text-pos-warning">
                  No se importan {review.result.skipped.length}:
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-xs">
                  {review.result.skipped.map((s) => (
                    <li key={s.index}>
                      <strong>{s.name}</strong> — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReview(null)}
                disabled={importing}
                className={actionButtonClass}
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void confirmImport()}
                disabled={importing || review.result.created === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Importar {review.result.created}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
