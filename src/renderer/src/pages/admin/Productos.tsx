import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Category, ProductWithCategory } from '@shared/types'
import { API_BASE_URL, ApiRequestError } from '@/api/client'
import { desactivarProducto, listCategoriasAdmin, listProductosAdmin } from '@/api/admin'
import { ProductoFormModal } from '@/components/admin/ProductoFormModal'
import { money } from '@/lib/format'

export default function Productos(): React.JSX.Element {
  const [rows, setRows] = useState<ProductWithCategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<number | null>(null)
  const [editing, setEditing] = useState<ProductWithCategory | null>(null)
  const [creating, setCreating] = useState(false)

  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [prods, cats] = await Promise.all([listProductosAdmin(), listCategoriasAdmin()])
        if (cancelled) return
        setRows(prods)
        setCategories(cats.filter((c) => c.active === 1))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nonce])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (catFilter === null || r.categoryId === catFilter) &&
        (term === '' || r.name.toLowerCase().includes(term) || r.barcode?.includes(term))
    )
  }, [rows, search, catFilter])

  async function deactivate(row: ProductWithCategory): Promise<void> {
    try {
      await desactivarProducto(row.id)
      toast.success(`"${row.name}" desactivado`)
      reload()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo desactivar')
    }
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Productos</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          Nuevo producto
        </button>
      </header>

      <div className="mb-3 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o código…"
          className="w-64 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <select
          value={catFilter ?? ''}
          onChange={(e) => setCatFilter(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2 text-right">Precio</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Sin productos.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-secondary/40 text-[10px] text-muted-foreground">
                        {row.imagePath ? (
                          <img
                            src={`${API_BASE_URL}/uploads/${row.imagePath}`}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          row.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium">{row.name}</div>
                        {row.barcode && (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {row.barcode}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.categoryName ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {money(row.price)}
                    {row.unit === 'KG' && <span className="text-muted-foreground">/kg</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.active === 1
                          ? 'bg-pos-success/15 text-pos-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {row.active === 1 ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setEditing(row)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-secondary"
                    >
                      Editar
                    </button>
                    {row.active === 1 && (
                      <button
                        onClick={() => void deactivate(row)}
                        className="rounded-md px-2 py-1 text-xs font-medium text-pos-danger hover:bg-pos-danger/10"
                      >
                        Desactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <ProductoFormModal
          product={editing}
          categories={categories}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
