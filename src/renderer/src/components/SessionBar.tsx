import { useNavigate } from 'react-router-dom'
import { LogOut, Store } from 'lucide-react'
import { logout as logoutRequest } from '@/api/auth'
import { useAuthStore } from '@/stores/auth.store'
import { useBrandingStore } from '@/stores/branding.store'

/** Barra superior: logo y nombre del negocio, usuario en sesión y cerrar sesión. */
export function SessionBar(): React.JSX.Element {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)
  const businessName = useBrandingStore((s) => s.name)
  const logoUrl = useBrandingStore((s) => s.logoUrl)

  async function onLogout(): Promise<void> {
    try {
      await logoutRequest()
    } catch {
      // el logout es best-effort: el token es stateless
    }
    clear()
    navigate('/login', { replace: true })
  }

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2.5">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-md border border-border bg-white object-contain p-0.5"
          />
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
            <Store size={16} />
          </span>
        )}
        <span className="truncate text-base font-semibold">{businessName || 'Punto de venta'}</span>
      </span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {user?.username} · {user?.role === 'ADMIN' ? 'Administrador' : 'Cobrador'}
        </span>
        <button
          onClick={() => void onLogout()}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition hover:bg-secondary"
        >
          <LogOut size={13} />
          Salir
        </button>
      </div>
    </header>
  )
}
