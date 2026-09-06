import { useState } from 'react'
import { toast } from 'sonner'
import type { CategoryWithCount } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { actualizarCategoria, crearCategoria } from '@/api/admin'
import { Modal } from '@/components/Modal'

export function CategoriaFormModal({
  category,
  onClose,
  onSaved
}: {
  category: CategoryWithCount | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [name, setName] = useState(category?.name ?? '')
  const [active, setActive] = useState(category ? category.active === 1 : true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    setError('')
    setSaving(true)
    try {
      if (category) await actualizarCategoria(category.id, { name, active })
      else await crearCategoria({ name, active })
      toast.success(category ? 'Categoría actualizada' : 'Categoría creada')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={category ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nombre</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activa (visible para el cobrador)
        </label>

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          onClick={() => void save()}
          disabled={saving || name.trim().length === 0}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
