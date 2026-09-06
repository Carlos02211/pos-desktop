import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { CreditAccountDetail, SettledMethod } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { getCuentaDetalle, registrarAbono } from '@/api/cuentas'
import { Modal } from '@/components/Modal'
import { dateTime, money, paymentLabel } from '@/lib/format'

const METHODS: SettledMethod[] = ['CASH', 'CARD', 'TRANSFER']

export function CuentaDetalleModal({
  accountId,
  canPay,
  onClose,
  onChanged
}: {
  accountId: number
  /** true si el usuario puede registrar abonos (cobrador con caja abierta). */
  canPay: boolean
  onClose: () => void
  onChanged?: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<CreditAccountDetail | null>(null)
  const [error, setError] = useState('')
  const [amountText, setAmountText] = useState('')
  const [method, setMethod] = useState<SettledMethod>('CASH')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCuentaDetalle(accountId)
      .then(setDetail)
      .catch(() => setError('No se pudo cargar la cuenta'))
  }, [accountId])

  const amount = Number.parseFloat(amountText.replace(',', '.'))
  const valid = useMemo(
    () => detail != null && Number.isFinite(amount) && amount > 0 && amount <= detail.balance,
    [detail, amount]
  )

  async function abonar(): Promise<void> {
    setSaving(true)
    try {
      const updated = await registrarAbono(accountId, { amount, paymentMethod: method })
      setDetail(updated)
      setAmountText('')
      toast.success(
        updated.status === 'PAID' ? 'Cuenta liquidada' : `Abono de ${money(amount)} registrado`
      )
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo registrar el abono')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={detail ? `Cuenta de ${detail.customerName}` : 'Cuenta'} onClose={onClose}>
      {error && <p className="text-sm text-pos-danger">{error}</p>}
      {!detail && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {detail && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Box label="Total">{money(detail.total)}</Box>
            <Box label="Abonado">{money(detail.paid)}</Box>
            <Box label="Saldo" tone={detail.balance > 0 ? 'warn' : 'good'}>
              {money(detail.balance)}
            </Box>
          </div>

          <p className="text-xs text-muted-foreground">
            {detail.ticketNumber ? `Ticket #${detail.ticketNumber} · ` : ''}
            Abierta el {dateTime(detail.createdAt)} por {detail.userName}
            {detail.status === 'PAID' && detail.closedAt
              ? ` · Liquidada el ${dateTime(detail.closedAt)}`
              : ''}
          </p>

          {detail.payments.length > 0 && (
            <div className="rounded-lg border border-border">
              <p className="border-b border-border px-3 py-1.5 text-xs font-semibold uppercase text-muted-foreground">
                Abonos
              </p>
              <ul className="divide-y divide-border">
                {detail.payments.map((p) => (
                  <li key={p.id} className="flex justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">
                      {dateTime(p.createdAt)} · {paymentLabel(p.paymentMethod)}
                    </span>
                    <span className="font-medium">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.status === 'OPEN' && canPay && (
            <div className="space-y-2 rounded-lg bg-secondary/40 p-3">
              <p className="text-sm font-medium">Registrar abono</p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  placeholder={detail.balance.toFixed(2)}
                  className="w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                />
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as SettledMethod)}
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {paymentLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAmountText(String(detail.balance))}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
                >
                  Liquidar ({money(detail.balance)})
                </button>
              </div>
              <button
                onClick={() => void abonar()}
                disabled={!valid || saving}
                className="w-full rounded-lg bg-pos-success px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Registrando…' : 'Registrar abono'}
              </button>
            </div>
          )}

          {detail.status === 'OPEN' && !canPay && (
            <p className="rounded-lg bg-pos-warning/15 px-3 py-2 text-xs text-pos-warning">
              Abre caja para recibir abonos de esta cuenta.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function Box({
  label,
  tone,
  children
}: {
  label: string
  tone?: 'warn' | 'good'
  children: React.ReactNode
}): React.JSX.Element {
  const color =
    tone === 'warn' ? 'text-pos-warning' : tone === 'good' ? 'text-pos-success' : 'text-foreground'
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-bold ${color}`}>{children}</p>
    </div>
  )
}
