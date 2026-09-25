import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { CashSessionSummary } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { cerrarCaja, getResumen } from '@/api/caja'
import { money } from '@/lib/format'
import { useCartStore } from '@/stores/cart.store'

export default function CajaCierre(): React.JSX.Element {
  const navigate = useNavigate()
  const clearCart = useCartStore((s) => s.clear)
  const [summary, setSummary] = useState<CashSessionSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'no-caja'>('loading')
  const [countText, setCountText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getResumen()
      .then((s) => {
        setSummary(s)
        setState('ready')
      })
      .catch((err) => {
        if (err instanceof ApiRequestError && err.status === 409) setState('no-caja')
        else setError('No se pudo cargar el resumen del turno')
      })
  }, [])

  const counted = Number.parseFloat(countText.replace(',', '.'))
  const difference = useMemo(
    () =>
      summary && Number.isFinite(counted)
        ? Math.round((counted - summary.expectedCash) * 100) / 100
        : null,
    [summary, counted]
  )
  const valid = Number.isFinite(counted) && counted >= 0

  async function onClose(): Promise<void> {
    setError('')
    setSubmitting(true)
    try {
      const res = await cerrarCaja(counted)
      clearCart()
      const diff = res.session.difference ?? 0
      toast.success(
        diff === 0
          ? 'Caja cerrada sin diferencia'
          : `Caja cerrada · ${diff > 0 ? 'sobrante' : 'faltante'} de ${money(Math.abs(diff))}`
      )
      if (!res.backup.ok) toast.warning('El respaldo automático falló')
      navigate('/cobrador', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo cerrar la caja')
    } finally {
      setSubmitting(false)
    }
  }

  if (state === 'loading') {
    return <Centered>Cargando resumen…</Centered>
  }
  if (state === 'no-caja') {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">No tienes una caja abierta.</p>
        <button
          onClick={() => navigate('/cobrador', { replace: true })}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Volver
        </button>
      </Centered>
    )
  }

  const s = summary!

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <h1 className="text-lg font-bold">Cerrar caja</h1>
        <p className="mt-1 text-sm text-muted-foreground">Turno de {s.salesCount} ventas.</p>

        <dl className="mt-4 space-y-1.5 text-sm">
          <Line label="Monto inicial" value={money(s.session.openingAmount)} />
          <Line label="Ventas en efectivo" value={money(s.totalCash)} />
          <Line label="Ventas con tarjeta" value={money(s.totalCard)} />
          <Line label="Ventas por transferencia" value={money(s.totalTransfer)} />
          {s.totalCredit > 0 && (
            <Line label="Fiado otorgado (no es efectivo)" value={money(s.totalCredit)} />
          )}
          {s.abonosCash > 0 && (
            <Line label="Abonos en efectivo recibidos" value={money(s.abonosCash)} />
          )}
          {s.cashIn > 0 && <Line label="Ingresos de efectivo" value={money(s.cashIn)} />}
          {s.cashOut > 0 && <Line label="Retiros de efectivo" value={`− ${money(s.cashOut)}`} />}
          <div className="my-1 border-t border-border" />
          <Line label="Efectivo esperado en caja" value={money(s.expectedCash)} strong />
        </dl>

        <label className="mt-4 block text-sm font-medium">Efectivo contado</label>
        <input
          autoFocus
          inputMode="decimal"
          value={countText}
          onChange={(e) => setCountText(e.target.value)}
          placeholder="0.00"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />

        {difference !== null && (
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Diferencia</span>
            <span
              className={
                difference === 0
                  ? 'font-semibold'
                  : difference > 0
                    ? 'font-semibold text-pos-success'
                    : 'font-semibold text-pos-danger'
              }
            >
              {difference > 0 ? '+' : ''}
              {money(difference)}{' '}
              {difference > 0 ? '(sobrante)' : difference < 0 ? '(faltante)' : ''}
            </span>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => navigate('/cobrador')}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm transition hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            onClick={() => void onClose()}
            disabled={!valid || submitting}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Cerrando…' : 'Cerrar caja'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Line({
  label,
  value,
  strong
}: {
  label: string
  value: string
  strong?: boolean
}): React.JSX.Element {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      {children}
    </div>
  )
}
