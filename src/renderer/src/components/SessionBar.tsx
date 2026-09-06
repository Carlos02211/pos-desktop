import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { logout as logoutRequest } from '@/api/auth'
import { useAuthStore } from '@/stores/auth.store'

/** Barra superior con el usuario en sesión y el botón de cerrar sesión. */
export function SessionBar(): React.JSX.Element {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)

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
      <span className="font-semibold tracking-[0.2em] text-muted-foreground">
        SPARTAN TECH · POS
      </span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {user?.username} · <span className="uppercase">{user?.role}</span>
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
