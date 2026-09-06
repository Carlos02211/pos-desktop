import { useState } from 'react'
import { toast } from 'sonner'
import type { CustomerWithBalance } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { actualizarCliente, crearCliente } from '@/api/cuentas'
import { Modal } from '@/components/Modal'

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

export function ClienteFormModal({
  customer,
  onClose,
  onSaved
}: {
  customer: CustomerWithBalance | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [active, setActive] = useState(customer ? customer.active === 1 : true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    setError('')
    setSaving(true)
    try {
      const payload = { name, phone, notes, active }
      if (customer) await actualizarCliente(customer.id, payload)
      else await crearCliente(payload)
      toast.success(customer ? 'Cliente actualizado' : 'Cliente creado')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={customer ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nombre</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Teléfono</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Notas</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activo
        </label>

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          onClick={() => void save()}
          disabled={saving || name.trim().length < 2}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
