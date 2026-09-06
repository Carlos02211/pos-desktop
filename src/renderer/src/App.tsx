import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { homeFor } from '@/lib/routing'
import Activation from '@/pages/Activation'
import Login from '@/pages/Login'
import AdminLayout from '@/pages/admin/AdminLayout'
import Categorias from '@/pages/admin/Categorias'
import Cortes from '@/pages/admin/Cortes'
import Dashboard from '@/pages/admin/Dashboard'
import Productos from '@/pages/admin/Productos'
import Usuarios from '@/pages/admin/Usuarios'
import Ventas from '@/pages/admin/Ventas'
import CajaApertura from '@/pages/cobrador/CajaApertura'
import CajaCierre from '@/pages/cobrador/CajaCierre'
import CobradorLayout from '@/pages/cobrador/CobradorLayout'
import PanelVenta from '@/pages/cobrador/PanelVenta'
import { useAuthStore } from '@/stores/auth.store'
import { useLicenseStore } from '@/stores/license.store'

function Splash({
  message,
  onRetry
}: {
  message: string
  onRetry?: () => void
}): React.JSX.Element {
  return (
    <div className="cobrador flex min-h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Reintentar
        </button>
      )}
    </div>
  )
}

/** Decide a dónde llevar la ruta raíz según licencia y sesión. */
function RootRedirect(): React.JSX.Element {
  const licenseActive = useLicenseStore((s) => s.status?.active ?? false)
  const user = useAuthStore((s) => s.user)
  if (!licenseActive) return <Navigate to="/activation" replace />
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={homeFor(user.role)} replace />
}

function App(): React.JSX.Element {
  const phase = useLicenseStore((s) => s.phase)
  const refresh = useLicenseStore((s) => s.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (phase === 'loading') return <Splash message="Iniciando…" />
  if (phase === 'unreachable') {
    return <Splash message="No se pudo conectar con el servidor local (:3001)." onRetry={refresh} />
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/activation" element={<Activation />} />
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute role="COBRADOR" />}>
          <Route path="/cobrador" element={<CobradorLayout />}>
            <Route index element={<PanelVenta />} />
            <Route path="apertura" element={<CajaApertura />} />
            <Route path="cierre" element={<CajaCierre />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute role="ADMIN" />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="productos" element={<Productos />} />
            <Route path="categorias" element={<Categorias />} />
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="ventas" element={<Ventas />} />
            <Route path="cortes" element={<Cortes />} />
          </Route>
        </Route>
        <Route path="*" element={<RootRedirect />} />
      </Routes>
      <Toaster richColors position="top-center" />
    </HashRouter>
  )
}

export default App
