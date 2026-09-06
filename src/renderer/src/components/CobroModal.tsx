import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { CreateSaleResponse, CustomerWithBalance, PaymentMethod } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { crearCliente, listClientes } from '@/api/cuentas'
import { crearVenta } from '@/api/ventas'
import { Modal } from '@/components/Modal'
import { money } from '@/lib/format'
import { useCartStore } from '@/stores/cart.store'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'CREDIT', label: 'Fiado' }
]

/** Montos sugeridos: el exacto y los siguientes billetes redondos. */
function quickAmounts(total: number): number[] {
  const rounded = Math.ceil(total / 100) * 100 || 100
  const options = new Set<number>([total, rounded, rounded + 100, rounded + 400])
  return [...options].filter((n) => n >= total).sort((a, b) => a - b)
}

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

export function CobroModal({
  total,
  onClose,
  onDone
}: {
  total: number
  onClose: () => void
  onDone: (sale: CreateSaleResponse) => void
}): React.JSX.Element {
  const items = useCartStore((s) => s.items)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [paidText, setPaidText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [customers, setCustomers] = useState<CustomerWithBalance[]>([])
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [newName, setNewName] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  useEffect(() => {
    listClientes()
      .then(setCustomers)
      .catch(() => {})
  }, [])

  const paid = Number.parseFloat(paidText.replace(',', '.'))
  const paidNum = Number.isFinite(paid) ? paid : 0

  const change = useMemo(
    () =>
      method === 'CASH' && Number.isFinite(paid) ? Math.round((paid - total) * 100) / 100 : null,
    [method, paid, total]
  )
  const cashShort = method === 'CASH' && (!Number.isFinite(paid) || paid < total)
  const creditDebt =
    method === 'CREDIT' ? Math.round((total - Math.min(paidNum, total)) * 100) / 100 : 0
  const hasCustomer = customerId !== '' || newName.trim().length >= 2
  const creditInvalid = method === 'CREDIT' && (!hasCustomer || paidNum >= total || paidNum < 0)

  async function ensureCustomer(): Promise<number> {
    if (customerId !== '') return customerId
    setCreatingCustomer(true)
    try {
      const c = await crearCliente({ name: newName.trim() })
      return c.id
    } finally {
      setCreatingCustomer(false)
    }
  }

  async function confirm(): Promise<void> {
    setError('')
    setSubmitting(true)
    try {
      let cId: number | undefined
      if (method === 'CREDIT') cId = await ensureCustomer()

      const sale = await crearVenta({
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        paymentMethod: method,
        amountPaid: method === 'CASH' || method === 'CREDIT' ? paidNum : undefined,
        customerId: cId
      })
      onDone(sale)
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'No se pudo registrar la venta'
      setError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = submitting || creatingCustomer || cashShort || creditInvalid

  return (
    <Modal title="Cobrar" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between rounded-lg bg-secondary/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-2xl font-bold">{money(total)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.value}
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
          <div className="space-y-2">
            <label className="block text-sm font-medium">Monto recibido</label>
            <input
              autoFocus
              inputMode="decimal"
              value={paidText}
              onChange={(e) => setPaidText(e.target.value)}
              placeholder={total.toFixed(2)}
              className={inputClass}
            />
            <div className="flex flex-wrap gap-1.5">
              {quickAmounts(total).map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setPaidText(String(amount))}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition hover:bg-secondary"
                >
                  {amount === total ? 'Exacto' : money(amount)}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cambio</span>
              <span className={cashShort ? 'text-pos-danger' : 'font-semibold text-pos-success'}>
                {change === null || cashShort ? '—' : money(change)}
              </span>
            </div>
          </div>
        )}

        {method === 'CREDIT' && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Cliente</label>
              {customerId === '' && customers.length > 0 && (
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}
                  className={inputClass}
                >
                  <option value="">— elige un cliente —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.balance > 0 ? ` (debe ${money(c.balance)})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {customerId !== '' && (
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span>{customers.find((c) => c.id === customerId)?.name}</span>
                  <button
                    onClick={() => setCustomerId('')}
                    className="text-xs text-primary hover:underline"
                  >
                    cambiar
                  </button>
                </div>
              )}
              {customerId === '' && (
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="…o escribe el nombre de un cliente nuevo"
                  className={`${inputClass} mt-1.5`}
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Abono inicial (efectivo)</label>
              <input
                inputMode="decimal"
                value={paidText}
                onChange={(e) => setPaidText(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-muted-foreground">Queda a deber</span>
                <span className="font-semibold text-pos-warning">{money(creditDebt)}</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          onClick={() => void confirm()}
          disabled={disabled}
          className="w-full rounded-lg bg-pos-success px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting || creatingCustomer
            ? 'Registrando…'
            : method === 'CREDIT'
              ? 'Registrar fiado'
              : 'Confirmar venta'}
        </button>
      </div>
    </Modal>
  )
}
