import { useEffect, useMemo, useState } from 'react'
import type { CashSessionListItem, UserListItem } from '@shared/types'
import { listCortes, listUsuarios } from '@/api/admin'
import { dateInputToUnix, dateTime, money } from '@/lib/format'

export default function Cortes(): React.JSX.Element {
  const [rows, setRows] = useState<CashSessionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserListItem[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [userId, setUserId] = useState<number | ''>('')

  useEffect(() => {
    let cancelled = false
    listUsuarios()
      .then((u) => !cancelled && setUsers(u))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filters = useMemo(
    () => ({
      from: dateInputToUnix(from),
      to: dateInputToUnix(to, true),
      userId: userId === '' ? undefined : userId
    }),
    [from, to, userId]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await listCortes(filters)
        if (!cancelled) setRows(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filters])

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Cortes de caja</h1>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Desde</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Hasta</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Cobrador</span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : '')}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Apertura</th>
              <th className="px-3 py-2">Cierre</th>
              <th className="px-3 py-2">Cobrador</th>
              <th className="px-3 py-2 text-right">Inicial</th>
              <th className="px-3 py-2 text-right">Esperado</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Sin cortes para estos filtros.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">{dateTime(row.openedAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.closedAt ? dateTime(row.closedAt) : <em>abierta</em>}
                  </td>
                  <td className="px-3 py-2">{row.userName}</td>
                  <td className="px-3 py-2 text-right">{money(row.openingAmount)}</td>
                  <td className="px-3 py-2 text-right">
                    {row.expectedAmount != null ? money(row.expectedAmount) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.closingAmount != null ? money(row.closingAmount) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {row.difference == null ? (
                      '—'
                    ) : (
                      <span
                        className={
                          row.difference === 0
                            ? ''
                            : row.difference > 0
                              ? 'text-pos-success'
                              : 'text-pos-danger'
                        }
                      >
                        {row.difference > 0 ? '+' : ''}
                        {money(row.difference)}
                      </span>
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
