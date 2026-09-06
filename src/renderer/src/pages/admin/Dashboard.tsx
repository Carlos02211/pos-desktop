import { useEffect, useState } from 'react'
import type { DashboardData } from '@shared/types'
import { getDashboard } from '@/api/admin'
import { dateTime, money, paymentLabel, timeOnly } from '@/lib/format'
import { useSocketStore } from '@/stores/socket.store'

export default function Dashboard(): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)
  const revision = useSocketStore((s) => s.revision)
  const connected = useSocketStore((s) => s.connected)

  useEffect(() => {
    let cancelled = false
    getDashboard()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
    // `revision` cambia con cada venta / apertura / cierre (Socket.io) → refresco en vivo.
  }, [revision])

  if (error) return <p className="text-sm text-pos-danger">No se pudo cargar el dashboard.</p>
  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-pos-success' : 'bg-pos-muted'}`}
          />
          {connected ? 'En vivo' : 'Sin conexión'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Ventas de hoy" value={money(data.totalSales)} />
        <Stat label="Transacciones" value={String(data.totalTransactions)} />
        <Stat label="Efectivo" value={money(data.byPaymentMethod.CASH)} />
        <Stat
          label="Tarjeta / Transf."
          value={money(data.byPaymentMethod.CARD + data.byPaymentMethod.TRANSFER)}
        />
        <Stat label="Por cobrar (fiado)" value={money(data.cuentasPorCobrar)} tone="warn" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border">
          <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">Cajas abiertas</h2>
          {data.openSessions.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">Ninguna caja abierta ahora.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.openSessions.map((s) => (
                <li key={s.cashSessionId} className="flex justify-between px-4 py-2 text-sm">
                  <span className="font-medium">{s.userName}</span>
                  <span className="text-muted-foreground">
                    desde {timeOnly(s.openedAt)} · {money(s.openingAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border">
          <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">Últimas ventas</h2>
          {data.recentSales.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">Sin ventas todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {data.recentSales.map((s) => (
                  <tr key={s.id} className="border-t border-border first:border-0">
                    <td className="px-4 py-2 text-muted-foreground">{dateTime(s.createdAt)}</td>
                    <td className="px-4 py-2">#{s.ticketNumber}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {paymentLabel(s.paymentMethod)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{money(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'warn'
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone === 'warn' ? 'text-pos-warning' : ''}`}>
        {value}
      </p>
    </div>
  )
}
