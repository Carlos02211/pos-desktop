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
  const [clienteQuery, setClienteQuery] = useState('')
  const [clienteId, setClienteId] = useState<number | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  useEffect(() => {
    listClientes()
      .then(setCustomers)
      .catch(() => {})
  }, [])

  const clienteSuggestions = useMemo(() => {
    const q = clienteQuery.trim().toLowerCase()
    if (!q) return []
    return customers.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6)
  }, [customers, clienteQuery])

  function pickCliente(c: CustomerWithBalance): void {
    setClienteId(c.id)
    setClienteQuery(c.name)
    setShowSuggestions(false)
  }

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
  const hasCustomer = clienteId != null || clienteQuery.trim().length >= 2
  const creditInvalid = method === 'CREDIT' && (!hasCustomer || paidNum >= total || paidNum < 0)

  /** undefined si el campo Cliente quedó vacío (válido en CASH/CARD/TRANSFER). */
  async function ensureCustomer(): Promise<number | undefined> {
    if (clienteId != null) return clienteId
    const trimmed = clienteQuery.trim()
    if (trimmed.length < 2) return undefined
    // Evita duplicar si el nombre ya existe pero el cajero no lo eligió de las sugerencias.
    const existing = customers.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing.id
    setCreatingCustomer(true)
    try {
      const c = await crearCliente({ name: trimmed })
      return c.id
    } finally {
      setCreatingCustomer(false)
    }
  }

  async function confirm(): Promise<void> {
    setError('')
    setSubmitting(true)
    try {
      const cId = await ensureCustomer()

      const sale = await crearVenta({
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
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

        <div className="relative">
          <label className="mb-1 block text-sm font-medium">
            Cliente
            {method !== 'CREDIT' && (
              <span className="font-normal text-muted-foreground"> (opcional)</span>
            )}
          </label>
          <input
            autoFocus={method !== 'CASH'}
            value={clienteQuery}
            onChange={(e) => {
              setClienteQuery(e.target.value)
              setClienteId(null)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
            placeholder="Busca un cliente o escribe uno nuevo…"
            className={inputClass}
          />
          {clienteId != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Cliente existente
              {(() => {
                const balance = customers.find((c) => c.id === clienteId)?.balance ?? 0
                return balance > 0 ? ` · debe ${money(balance)}` : ''
              })()}
            </p>
          )}
          {showSuggestions && clienteSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              {clienteSuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={() => pickCliente(c)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  {c.name}
                  {c.balance > 0 ? ` (debe ${money(c.balance)})` : ''}
                </button>
              ))}
            </div>
          )}
          {showSuggestions &&
            clienteId == null &&
            clienteQuery.trim().length >= 2 &&
            clienteSuggestions.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Se creará como cliente nuevo.</p>
            )}
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
