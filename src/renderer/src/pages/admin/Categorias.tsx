import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { CategoryWithCount } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { desactivarCategoria, listCategoriasAdmin } from '@/api/admin'
import { CategoriaFormModal } from '@/components/admin/CategoriaFormModal'

export default function Categorias(): React.JSX.Element {
  const [rows, setRows] = useState<CategoryWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CategoryWithCount | null>(null)
  const [creating, setCreating] = useState(false)

  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await listCategoriasAdmin()
        if (!cancelled) setRows(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nonce])

  async function deactivate(row: CategoryWithCount): Promise<void> {
    try {
      await desactivarCategoria(row.id)
      toast.success(`"${row.name}" desactivada`)
      reload()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo desactivar')
    }
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Categorías</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          Nueva categoría
        </button>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Productos</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Sin categorías.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.productCount}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.active === 1
                          ? 'bg-pos-success/15 text-pos-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {row.active === 1 ? 'Activa' : 'Inactiva'}
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
        <CategoriaFormModal
          category={editing}
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
