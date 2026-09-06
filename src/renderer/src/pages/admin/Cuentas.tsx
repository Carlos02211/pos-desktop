import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CreditAccountListItem, CreditQuery, CustomerWithBalance } from '@shared/types'
import { listClientes, listCuentas, totalPorCobrar } from '@/api/cuentas'
import { CuentaDetalleModal } from '@/components/CuentaDetalleModal'
import { CuentasTable } from '@/components/CuentasTable'
import { dateInputToUnix, money } from '@/lib/format'

export default function Cuentas(): React.JSX.Element {
  const [rows, setRows] = useState<CreditAccountListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([])
  const [status, setStatus] = useState<'OPEN' | 'PAID' | 'all'>('OPEN')
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    listClientes(true)
      .then(setCustomers)
      .catch(() => {})
  }, [])

  const query: CreditQuery = useMemo(
    () => ({
      status,
      customerId: customerId === '' ? undefined : customerId,
      from: dateInputToUnix(from),
      to: dateInputToUnix(to, true)
    }),
    [status, customerId, from, to]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [accounts, t] = await Promise.all([listCuentas(query), totalPorCobrar()])
        if (cancelled) return
        setRows(accounts)
        setTotal(t.total)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [query, nonce])

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Cuentas por cobrar</h1>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total por cobrar</p>
          <p className="text-lg font-bold text-pos-warning">{money(total)}</p>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Estado">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'OPEN' | 'PAID' | 'all')}
            className={sel}
          >
            <option value="OPEN">Pendientes</option>
            <option value="PAID">Liquidadas</option>
            <option value="all">Todas</option>
          </select>
        </Field>
        <Field label="Cliente">
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}
            className={sel}
          >
            <option value="">Todos</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Desde">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={sel}
          />
        </Field>
        <Field label="Hasta">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={sel} />
        </Field>
      </div>

      <CuentasTable rows={rows} loading={loading} onOpen={setDetailId} />

      {detailId !== null && (
        <CuentaDetalleModal
          accountId={detailId}
          canPay={false}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

const sel =
  'rounded-lg border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring'

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
