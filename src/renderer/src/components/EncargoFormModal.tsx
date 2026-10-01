import { useState } from 'react'
import { toast } from 'sonner'
import type { CreateOrderResponse, SettledMethod } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { crearEncargo } from '@/api/encargos'
import { Modal } from '@/components/Modal'
import { localDateISO, money } from '@/lib/format'
import { randomId } from '@/lib/utils'
import { useCartStore } from '@/stores/cart.store'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

const METHODS: { value: SettledMethod; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'TRANSFER', label: 'Transferencia' }
]

/** Hora sugerida: dentro de una hora, redondeada a la media hora siguiente ("14:30"). */
function suggestedTime(): string {
  const d = new Date(Date.now() + 60 * 60_000)
  const mins = d.getMinutes() <= 30 ? 30 : 60
  d.setMinutes(mins, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return localDateISO(d)
}

/** "2026-10-03" + "14:30" en la hora de esta computadora → Unix (s). */
function toUnix(date: string, time: string): number | null {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  if (![y, m, d, h, min].every(Number.isFinite)) return null
  return Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000)
}

/**
 * Guardar el carrito como encargo ("apártame 2 pollos para las 2"): a nombre de quién, cuándo
 * pasa y, si deja anticipo, cuánto y cómo lo pagó. El anticipo se cobra en ese momento.
 */
export function EncargoFormModal({
  total,
  onClose,
  onDone
}: {
  total: number
  onClose: () => void
  onDone: (res: CreateOrderResponse) => void
}): React.JSX.Element {
  const items = useCartStore((s) => s.items)
  const [clientRequestId] = useState(() => randomId())
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState(() => localDateISO())
  const [time, setTime] = useState(suggestedTime)
  const [notes, setNotes] = useState('')
  const [depositText, setDepositText] = useState('')
  const [method, setMethod] = useState<SettledMethod>('CASH')
  const [paidText, setPaidText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const today = localDateISO()
  const tomorrow = addDays(1)
  const parse = (t: string): number =>
    t.trim() === '' ? 0 : Number.parseFloat(t.replace(',', '.'))
  const deposit = parse(depositText)
  const paid = paidText.trim() === '' ? deposit : parse(paidText)
  const pickupAt = toUnix(date, time)
  const depositValid = Number.isFinite(deposit) && deposit >= 0 && deposit <= total
  const cashShort = deposit > 0 && method === 'CASH' && (!Number.isFinite(paid) || paid < deposit)
  const valid =
    name.trim().length > 0 && pickupAt != null && depositValid && !cashShort && items.length > 0

  async function save(): Promise<void> {
    if (!valid || pickupAt == null) return
    setError('')
    setSubmitting(true)
    try {
      const res = await crearEncargo({
        customerName: name.trim(),
        phone: phone.trim() || undefined,
        pickupAt,
        notes: notes.trim() || undefined,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          price: i.openPrice || i.price !== i.originalPrice ? i.price : undefined,
          note: i.note,
          optionIds: i.optionIds
        })),
        ...(deposit > 0
          ? {
              deposit,
              depositMethod: method,
              amountPaid: method === 'CASH' ? paid : undefined
            }
          : {}),
        clientRequestId
      })
      onDone(res)
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'No se pudo guardar el encargo'
      setError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const dayChip = (value: string, label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setDate(value)}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
        date === value
          ? 'border-ring bg-primary text-primary-foreground'
          : 'border-border hover:bg-secondary'
      }`}
    >
      {label}
    </button>
  )

  return (
    <Modal title="Nuevo encargo" onClose={onClose} busy={submitting}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">A nombre de</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Doña Rosa"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Teléfono (opcional)</span>
            <input
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              placeholder="Para avisarle"
              className={inputClass}
            />
          </label>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium">Pasa por él</span>
          <div className="flex flex-wrap items-center gap-2">
            {dayChip(today, 'Hoy')}
            {dayChip(tomorrow, 'Mañana')}
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Otro día"
              className="rounded-lg border border-input bg-background px-2 py-2 text-sm outline-none focus:border-ring"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Hora"
              className="rounded-lg border border-input bg-background px-2 py-2 text-sm font-semibold outline-none focus:border-ring"
            />
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nota (opcional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={200}
            placeholder="Dirección si es a domicilio, quién pasa por él…"
            className={inputClass}
          />
        </label>

        <div className="space-y-2 rounded-lg border border-border px-3 py-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Total del encargo</span>
            <span className="text-lg font-bold">{money(total)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Anticipo (opcional)</span>
              <input
                inputMode="decimal"
                value={depositText}
                onChange={(e) => setDepositText(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </label>
            <button
              type="button"
              onClick={() => setDepositText(String(total))}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-secondary"
            >
              Paga todo
            </button>
          </div>
          {!depositValid && (
            <p className="text-xs text-pos-danger">
              El anticipo no puede ser mayor que el total del encargo.
            </p>
          )}
          {deposit > 0 && depositValid && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                      method === m.value
                        ? 'border-ring bg-primary text-primary-foreground'
                        : 'border-border hover:bg-secondary'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {method === 'CASH' && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Recibido</span>
                  <input
                    inputMode="decimal"
                    value={paidText}
                    onChange={(e) => setPaidText(e.target.value)}
                    placeholder={deposit.toFixed(2)}
                    className={inputClass}
                  />
                  <span className="mt-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">Cambio</span>
                    <span
                      className={cashShort ? 'text-pos-danger' : 'font-semibold text-pos-success'}
                    >
                      {cashShort ? '—' : money(Math.round((paid - deposit) * 100) / 100)}
                    </span>
                  </span>
                </label>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Resta al recogerlo</span>
                <span className="font-semibold">
                  {money(Math.round((total - deposit) * 100) / 100)}
                </span>
              </div>
            </>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          type="submit"
          disabled={!valid || submitting}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting
            ? 'Guardando…'
            : deposit > 0
              ? `Guardar y cobrar anticipo de ${money(deposit)}`
              : 'Guardar encargo'}
        </button>
      </form>
    </Modal>
  )
}
