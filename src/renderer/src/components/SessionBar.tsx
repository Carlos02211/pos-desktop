import { useNavigate } from 'react-router-dom'
import { LogOut, Menu, Store } from 'lucide-react'
import { logout as logoutRequest } from '@/api/auth'
import { useAuthStore } from '@/stores/auth.store'
import { useBrandingStore } from '@/stores/branding.store'
import { Clock } from '@/components/Clock'

/** Barra superior: logo y nombre del negocio, usuario en sesión y cerrar sesión. */
export function SessionBar({ onMenu }: { onMenu?: () => void } = {}): React.JSX.Element {
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
    <header className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-border bg-card px-3 py-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:gap-3 sm:px-4">
      <span className="flex min-w-0 items-center gap-2.5">
        {onMenu && (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Abrir menú"
            className="-ml-1 rounded-lg p-2 hover:bg-secondary md:hidden"
          >
            <Menu size={20} />
          </button>
        )}
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
      <Clock />
      <div className="flex items-center justify-end gap-3">
        <span className="hidden truncate text-muted-foreground lg:inline">
          {user?.username} · {user?.role === 'ADMIN' ? 'Administrador' : 'Cobrador'}
        </span>
        <button
          onClick={() => void onLogout()}
          title={`Salir (${user?.username ?? ''})`}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-secondary"
        >
          <LogOut size={13} />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </div>
    </header>
  )
}
