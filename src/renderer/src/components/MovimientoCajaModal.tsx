import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { CashMovement, CashMovementType } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { getMovimientos, getResumen, registrarMovimiento } from '@/api/caja'
import { Modal } from '@/components/Modal'
import { dateTime, money } from '@/lib/format'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

/** Retiro o ingreso de efectivo de la caja durante el turno (gastos, cambio, depósitos). */
export function MovimientoCajaModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [type, setType] = useState<CashMovementType>('OUT')
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<CashMovement[]>([])
  // Efectivo que debería haber en el cajón ahora (el mismo cálculo que el cierre).
  const [available, setAvailable] = useState<number | null>(null)

  useEffect(() => {
    getMovimientos()
      .then(setHistory)
      .catch(() => {})
    getResumen()
      .then((r) => setAvailable(r.expectedCash))
      .catch(() => {})
  }, [])

  const amount = Number.parseFloat(amountText.replace(',', '.'))
  const valid = Number.isFinite(amount) && amount > 0 && reason.trim().length >= 2

  async function submit(): Promise<void> {
    setError('')
    setSubmitting(true)
    try {
      const mov = await registrarMovimiento({ type, amount, reason: reason.trim() })
      setHistory((h) => [...h, mov])
      setAvailable((a) => (a === null ? a : a + (type === 'IN' ? mov.amount : -mov.amount)))
      setAmountText('')
      setReason('')
      toast.success(type === 'OUT' ? 'Retiro registrado' : 'Ingreso registrado')
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo registrar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Efectivo de caja" onClose={onClose} busy={submitting}>
      <div className="space-y-4">
        {available !== null && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Efectivo en caja ahora</span>
            <span className="font-semibold tabular-nums">{money(available)}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimiento">
          {(
            [
              {
                v: 'OUT',
                label: 'Retiro',
                hint: 'Sale dinero',
                on: 'border-pos-danger bg-pos-danger/15 text-pos-danger'
              },
              {
                v: 'IN',
                label: 'Ingreso',
                hint: 'Entra dinero',
                on: 'border-pos-success bg-pos-success/15 text-pos-success'
              }
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={type === o.v}
              onClick={() => setType(o.v)}
              className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold transition ${
                type === o.v ? o.on : 'border-border text-muted-foreground hover:bg-secondary'
              }`}
            >
              {o.label}
              <span className="block text-xs font-normal opacity-80">{o.hint}</span>
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Monto</label>
          <input
            autoFocus
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Motivo</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={type === 'OUT' ? 'Ej. compra de bolsas' : 'Ej. depósito del dueño'}
            className={inputClass}
          />
        </div>

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          onClick={() => void submit()}
          disabled={!valid || submitting}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? 'Guardando…' : type === 'OUT' ? 'Registrar retiro' : 'Registrar ingreso'}
        </button>

        {history.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border text-sm">
            {history.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-b border-border px-3 py-1.5 last:border-0"
              >
                <span className="truncate">
                  <span className={m.type === 'OUT' ? 'text-pos-danger' : 'text-pos-success'}>
                    {m.type === 'OUT' ? '−' : '+'}
                    {money(m.amount)}
                  </span>{' '}
                  <span className="text-muted-foreground">{m.reason}</span>
                </span>
                <span className="shrink-0 pl-2 text-xs text-muted-foreground">
                  {dateTime(m.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
