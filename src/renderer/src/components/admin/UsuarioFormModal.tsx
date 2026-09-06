import { useState } from 'react'
import { toast } from 'sonner'
import type { Role, UserListItem } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { actualizarUsuario, crearUsuario } from '@/api/admin'
import { Modal } from '@/components/Modal'

export function UsuarioFormModal({
  user,
  onClose,
  onSaved
}: {
  user: UserListItem | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [username, setUsername] = useState(user?.username ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'COBRADOR')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const passwordRequired = !user
  const valid =
    username.trim().length >= 3 &&
    (!passwordRequired || password.length >= 6) &&
    (password.length === 0 || password.length >= 6)

  async function save(): Promise<void> {
    setError('')
    setSaving(true)
    try {
      if (user) {
        await actualizarUsuario(user.id, {
          username: username.trim(),
          role,
          ...(password ? { password } : {})
        })
      } else {
        await crearUsuario({ username: username.trim(), password, role })
      }
      toast.success(user ? 'Usuario actualizado' : 'Usuario creado')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={user ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Usuario</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Rol</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          >
            <option value="COBRADOR">Cobrador</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {user ? 'Nueva contraseña (opcional)' : 'Contraseña'}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={user ? 'Dejar en blanco para no cambiarla' : 'mínimo 6 caracteres'}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        {error && (
          <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger">{error}</p>
        )}

        <button
          onClick={() => void save()}
          disabled={saving || !valid}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
