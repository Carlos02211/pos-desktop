import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CashMovementWithUser, CashSessionListItem, UserListItem } from '@shared/types'
import { getMovimientosCorte, listCortes, listUsuarios } from '@/api/admin'
import { dateInputToUnix, dateTime, money } from '@/lib/format'

/** Detalle de retiros / ingresos de un turno (se carga al desplegar la fila). */
function MovimientosCorte({ sessionId }: { sessionId: number }): React.JSX.Element {
  const [movs, setMovs] = useState<CashMovementWithUser[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    getMovimientosCorte(sessionId)
      .then(setMovs)
      .catch(() => setError(true))
  }, [sessionId])

  if (error)
    return <p className="text-sm text-pos-danger">No se pudieron cargar los movimientos.</p>
  if (!movs) return <p className="text-sm text-muted-foreground">Cargando…</p>
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1 pr-3 font-medium">Hora</th>
          <th className="py-1 pr-3 font-medium">Tipo</th>
          <th className="py-1 pr-3 text-right font-medium">Monto</th>
          <th className="py-1 pr-3 font-medium">Motivo</th>
          <th className="py-1 font-medium">Registró</th>
        </tr>
      </thead>
      <tbody>
        {movs.map((m) => (
          <tr key={m.id} className="border-t border-border/60">
            <td className="py-1.5 pr-3 text-muted-foreground">{dateTime(m.createdAt)}</td>
            <td className="py-1.5 pr-3">
              <span
                className={
                  m.type === 'OUT'
                    ? 'rounded bg-pos-danger/15 px-1.5 py-0.5 text-xs font-medium text-pos-danger'
                    : 'rounded bg-pos-success/15 px-1.5 py-0.5 text-xs font-medium text-pos-success'
                }
              >
                {m.type === 'OUT' ? 'Retiro' : 'Ingreso'}
              </span>
            </td>
            <td className="py-1.5 pr-3 text-right font-medium tabular-nums">
              {m.type === 'OUT' ? '−' : '+'}
              {money(m.amount)}
            </td>
            <td className="py-1.5 pr-3">{m.reason}</td>
            <td className="py-1.5">{m.userName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const COLS = 10

export default function Cortes(): React.JSX.Element {
  const [rows, setRows] = useState<CashSessionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserListItem[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [userId, setUserId] = useState<number | ''>('')
  const [expanded, setExpanded] = useState<number | null>(null)

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
              <th className="w-8 px-2 py-2" aria-label="Detalle" />
              <th className="px-3 py-2 text-right">Inicial</th>
              <th className="px-3 py-2 text-right">Retiros</th>
              <th className="px-3 py-2 text-right">Ingresos</th>
              <th className="px-3 py-2 text-right">Esperado</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLS} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-3 py-6 text-center text-muted-foreground">
                  Sin cortes para estos filtros.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className={
                      row.movementCount > 0
                        ? 'cursor-pointer border-t border-border hover:bg-secondary/40'
                        : 'border-t border-border'
                    }
                    onClick={() =>
                      row.movementCount > 0 && setExpanded((e) => (e === row.id ? null : row.id))
                    }
                  >
                    <td className="px-3 py-2 text-muted-foreground">{dateTime(row.openedAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.closedAt ? dateTime(row.closedAt) : <em>abierta</em>}
                    </td>
                    <td className="px-3 py-2">{row.userName}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {row.movementCount > 0 && (
                        <button
                          type="button"
                          aria-expanded={expanded === row.id}
                          aria-label={`Ver ${row.movementCount} movimientos de efectivo`}
                          className="rounded p-0.5 hover:bg-secondary"
                        >
                          {expanded === row.id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{money(row.openingAmount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.cashOut > 0 ? (
                        <span className="text-pos-danger">−{money(row.cashOut)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.cashIn > 0 ? (
                        <span className="text-pos-success">+{money(row.cashIn)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
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
                          {row.difference > 0 ? '+' : row.difference < 0 ? '−' : ''}
                          {money(Math.abs(row.difference))}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expanded === row.id && (
                    <tr className="bg-secondary/20">
                      <td colSpan={COLS} className="px-6 py-3">
                        <MovimientosCorte sessionId={row.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
