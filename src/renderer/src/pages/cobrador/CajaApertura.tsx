import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ApiRequestError } from '@/api/client'
import { abrirCaja, getSesionActiva } from '@/api/caja'
import { money } from '@/lib/format'

export default function CajaApertura(): React.JSX.Element {
  const navigate = useNavigate()
  const [amountText, setAmountText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Si ya hay caja abierta, no tiene sentido esta pantalla.
  useEffect(() => {
    getSesionActiva()
      .then((s) => {
        if (s) navigate('/cobrador', { replace: true })
      })
      .catch(() => {})
  }, [navigate])

  const amount = Number.parseFloat(amountText.replace(',', '.'))
  const valid = Number.isFinite(amount) && amount >= 0

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await abrirCaja(amount)
      toast.success(`Caja abierta con ${money(amount)}`)
      navigate('/cobrador', { replace: true })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo abrir la caja')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg"
      >
        <h1 className="text-lg font-bold">Abrir caja</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Declara el efectivo con el que inicias el turno.
        </p>

        <label className="mt-4 block text-sm font-medium">Monto inicial</label>
        <input
          autoFocus
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          placeholder="0.00"
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />

        {error && (
          <p className="mt-3 rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!valid || submitting}
          className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Abriendo…' : 'Abrir caja'}
        </button>
      </form>
    </div>
  )
}
