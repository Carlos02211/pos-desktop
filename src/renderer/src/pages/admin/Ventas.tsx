import { useEffect, useMemo, useState } from 'react'
import type { PaymentMethod, SaleListItem, UserListItem } from '@shared/types'
import { listUsuarios, listVentas } from '@/api/admin'
import { VentaDetalleModal } from '@/components/admin/VentaDetalleModal'
import { dateInputToUnix, dateTime, money, paymentLabel } from '@/lib/format'

const PAGE_SIZE = 50

export default function Ventas(): React.JSX.Element {
  const [rows, setRows] = useState<SaleListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserListItem[]>([])

  const [from, setFromRaw] = useState('')
  const [to, setToRaw] = useState('')
  const [userId, setUserIdRaw] = useState<number | ''>('')
  const [method, setMethodRaw] = useState<PaymentMethod | ''>('')
  const [detailId, setDetailId] = useState<number | null>(null)

  // Cualquier cambio de filtro vuelve a la página 1.
  const setFrom = (v: string): void => {
    setFromRaw(v)
    setPage(1)
  }
  const setTo = (v: string): void => {
    setToRaw(v)
    setPage(1)
  }
  const setUserId = (v: number | ''): void => {
    setUserIdRaw(v)
    setPage(1)
  }
  const setMethod = (v: PaymentMethod | ''): void => {
    setMethodRaw(v)
    setPage(1)
  }

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
      page,
      pageSize: PAGE_SIZE,
      from: dateInputToUnix(from),
      to: dateInputToUnix(to, true),
      userId: userId === '' ? undefined : userId,
      paymentMethod: method === '' ? undefined : method
    }),
    [page, from, to, userId, method]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await listVentas(filters)
        if (cancelled) return
        setRows(res.rows)
        setTotal(res.total)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filters])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Historial de ventas</h1>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Desde">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Hasta">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Cobrador">
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
        </Field>
        <Field label="Método">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            <option value="CASH">Efectivo</option>
            <option value="CARD">Tarjeta</option>
            <option value="TRANSFER">Transferencia</option>
          </select>
        </Field>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Cobrador</th>
              <th className="px-3 py-2">Método</th>
              <th className="px-3 py-2 text-right">Art.</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Sin ventas para estos filtros.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setDetailId(row.id)}
                  className="cursor-pointer border-t border-border hover:bg-secondary/40"
                >
                  <td className="px-3 py-2 text-muted-foreground">{dateTime(row.createdAt)}</td>
                  <td className="px-3 py-2">#{row.ticketNumber}</td>
                  <td className="px-3 py-2">{row.userName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {paymentLabel(row.paymentMethod)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{row.itemCount}</td>
                  <td className="px-3 py-2 text-right font-medium">{money(row.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} ventas</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>

      {detailId !== null && (
        <VentaDetalleModal saleId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
