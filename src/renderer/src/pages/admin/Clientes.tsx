import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { CustomerWithBalance } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { actualizarCliente, crearCliente, listClientes } from '@/api/cuentas'
import { money } from '@/lib/format'

/**
 * Directorio de clientes para el cobro a crédito. Sirve como fuente del buscador
 * de "Cliente" al cobrar (`CobroModal`) — un nombre nuevo escrito ahí se agrega
 * aquí solo. El saldo y las cuentas abiertas se ven en "Cuentas por cobrar".
 */
export default function Clientes(): React.JSX.Element {
  const [rows, setRows] = useState<CustomerWithBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await listClientes()
        if (!cancelled) setRows(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nonce])

  async function add(): Promise<void> {
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    setSaving(true)
    try {
      await crearCliente({ name: trimmed })
      setName('')
      toast.success(`"${trimmed}" agregado`)
      reload()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo agregar')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit(row: CustomerWithBalance): Promise<void> {
    const trimmed = editName.trim()
    if (trimmed.length < 2 || trimmed === row.name) {
      setEditingId(null)
      return
    }
    try {
      await actualizarCliente(row.id, { name: trimmed })
      toast.success('Cliente actualizado')
      setEditingId(null)
      reload()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo actualizar')
    }
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-bold">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Directorio de nombres para el cobro a crédito. El saldo se ve en Cuentas por cobrar.
        </p>
      </header>

      <div className="mb-3 flex max-w-md gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
          placeholder="Nombre del cliente…"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          onClick={() => void add()}
          disabled={saving || name.trim().length < 2}
          className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Agregar
        </button>
      </div>

      <div className="max-w-md overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  Sin clientes.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    {editingId === row.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEdit(row)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => void saveEdit(row)}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
                      />
                    ) : (
                      row.name
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right ${
                      row.balance > 0 ? 'text-pos-warning' : 'text-muted-foreground'
                    }`}
                  >
                    {row.balance > 0 ? money(row.balance) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editingId !== row.id && (
                      <button
                        onClick={() => {
                          setEditingId(row.id)
                          setEditName(row.name)
                        }}
                        className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-secondary"
                      >
                        Renombrar
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
