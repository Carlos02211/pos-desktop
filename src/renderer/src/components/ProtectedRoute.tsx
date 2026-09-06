import { Navigate, Outlet } from 'react-router-dom'
import type { Role } from '@shared/types'
import { useAuthStore } from '@/stores/auth.store'
import { useLicenseStore } from '@/stores/license.store'
import { homeFor } from '@/lib/routing'

/**
 * Guarda de rutas privadas:
 *   - sin licencia válida  → /activation
 *   - sin sesión           → /login
 *   - rol insuficiente     → a la home del propio rol
 *
 * ADMIN entra a cualquier área.
 */
export function ProtectedRoute({ role }: { role?: Role }): React.JSX.Element {
  const licenseActive = useLicenseStore((s) => s.status?.active ?? false)
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  if (!licenseActive) return <Navigate to="/activation" replace />
  if (!token || !user) return <Navigate to="/login" replace />
  if (role && user.role !== 'ADMIN' && user.role !== role) {
    return <Navigate to={homeFor(user.role)} replace />
  }
  return <Outlet />
}
