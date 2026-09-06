import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { ReportType, SalesReport } from '@shared/types'
import { getReporte, type ReportParams } from '@/api/admin'
import { downloadFile } from '@/lib/download'
import { localDateISO, localMonthISO, money } from '@/lib/format'

const TABS: { type: ReportType; label: string }[] = [
  { type: 'diario', label: 'Diario' },
  { type: 'semanal', label: 'Semanal' },
  { type: 'mensual', label: 'Mensual' }
]

export default function Reportes(): React.JSX.Element {
  const [tab, setTab] = useState<ReportType>('diario')
  const [fecha, setFecha] = useState(localDateISO())
  const [inicio, setInicio] = useState(localDateISO())
  const [mes, setMes] = useState(localMonthISO())
  const [report, setReport] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(true)

  const params: ReportParams = useMemo(() => {
    if (tab === 'diario') return { fecha }
    if (tab === 'semanal') return { inicio }
    const [y, m] = mes.split('-')
    return { anio: Number(y), mes: Number(m) }
  }, [tab, fecha, inicio, mes])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await getReporte(tab, params)
        if (!cancelled) setReport(data)
      } catch {
        if (!cancelled) setReport(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, params])

  async function exportar(formato: 'excel' | 'pdf'): Promise<void> {
    try {
      await downloadFile(`/api/reportes/exportar/${formato}`, { tipo: tab, ...params })
    } catch {
      toast.error('No se pudo generar el archivo')
    }
  }

  const chartData = useMemo(
    () => (report?.buckets ?? []).map((b) => ({ label: b.label, total: b.total })),
    [report]
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Reportes</h1>
        <div className="flex gap-2">
          <button
            onClick={() => void exportar('excel')}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-secondary"
          >
            <Download size={14} /> Excel
          </button>
          <button
            onClick={() => void exportar('pdf')}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-secondary"
          >
            <Download size={14} /> PDF
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.type}
              onClick={() => setTab(t.type)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === t.type
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'diario' && (
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
        )}
        {tab === 'semanal' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Semana desde
            <input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
        )}
        {tab === 'mensual' && (
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />
        )}
      </div>

      {loading && !report ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !report ? (
        <p className="text-sm text-pos-danger">No se pudo cargar el reporte.</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total de ventas" value={money(report.totalSales)} />
            <Stat label="Transacciones" value={String(report.totalTransactions)} />
            <Stat label="Efectivo" value={money(report.byPaymentMethod.CASH)} />
            <Stat
              label="Tarjeta / Transf."
              value={money(report.byPaymentMethod.CARD + report.byPaymentMethod.TRANSFER)}
            />
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Ventas por {tab === 'diario' ? 'hora' : 'día'}
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--color-border)' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-secondary)' }}
                    formatter={(v) => money(Number(v))}
                    labelFormatter={(l) => `Ventas · ${l}`}
                    contentStyle={{
                      background: 'var(--color-card)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      fontSize: 12
                    }}
                  />
                  <Bar dataKey="total" fill="var(--brand-accent)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">
              Top 5 productos
            </h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Producto</th>
                  <th className="px-4 py-2 text-right">Cantidad</th>
                  <th className="px-4 py-2 text-right">Ingreso</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-4 text-center text-muted-foreground">
                      Sin ventas en el periodo.
                    </td>
                  </tr>
                ) : (
                  report.topProducts.map((p) => (
                    <tr key={p.productId} className="border-t border-border">
                      <td className="px-4 py-2">{p.name}</td>
                      <td className="px-4 py-2 text-right">{p.quantity}</td>
                      <td className="px-4 py-2 text-right font-medium">{money(p.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  )
}
