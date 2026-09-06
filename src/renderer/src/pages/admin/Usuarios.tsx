import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { UserListItem } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { actualizarUsuario, desactivarUsuario, listUsuarios } from '@/api/admin'
import { UsuarioFormModal } from '@/components/admin/UsuarioFormModal'
import { dateTime } from '@/lib/format'
import { useAuthStore } from '@/stores/auth.store'

export default function Usuarios(): React.JSX.Element {
  const me = useAuthStore((s) => s.user)
  const [rows, setRows] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [editing, setEditing] = useState<UserListItem | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await listUsuarios()
        if (!cancelled) setRows(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nonce])

  async function toggleActive(row: UserListItem): Promise<void> {
    try {
      if (row.active === 1) await desactivarUsuario(row.id)
      else await actualizarUsuario(row.id, { active: true })
      toast.success(row.active === 1 ? 'Usuario desactivado' : 'Usuario reactivado')
      reload()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo actualizar')
    }
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Usuarios</h1>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          Nuevo usuario
        </button>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Alta</th>
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
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    {row.username}
                    {me?.id === row.id && (
                      <span className="ml-1 text-xs text-muted-foreground">(tú)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.role === 'ADMIN' ? 'Administrador' : 'Cobrador'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{dateTime(row.createdAt)}</td>
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
                    {me?.id !== row.id && (
                      <button
                        onClick={() => void toggleActive(row)}
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          row.active === 1
                            ? 'text-pos-danger hover:bg-pos-danger/10'
                            : 'text-pos-success hover:bg-pos-success/10'
                        }`}
                      >
                        {row.active === 1 ? 'Desactivar' : 'Reactivar'}
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
        <UsuarioFormModal
          user={editing}
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
