import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  BarChart3,
  Boxes,
  HandCoins,
  LayoutDashboard,
  Receipt,
  Settings,
  Tags,
  UserRound,
  Users,
  Wallet,
  X
} from 'lucide-react'
import { SessionBar } from '@/components/SessionBar'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/productos', label: 'Productos', icon: Boxes, end: false },
  { to: '/admin/categorias', label: 'Categorías', icon: Tags, end: false },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users, end: false },
  { to: '/admin/clientes', label: 'Clientes', icon: UserRound, end: false },
  { to: '/admin/ventas', label: 'Ventas', icon: Receipt, end: false },
  { to: '/admin/cuentas', label: 'Cuentas por cobrar', icon: HandCoins, end: false },
  { to: '/admin/cortes', label: 'Cortes de caja', icon: Wallet, end: false },
  { to: '/admin/reportes', label: 'Reportes', icon: BarChart3, end: false },
  { to: '/admin/configuracion', label: 'Configuración', icon: Settings, end: false }
]

/**
 * Marco del panel de administración: tema claro, barra superior + menú lateral.
 * En pantallas angostas (celular) el menú se oculta y se abre como panel con el botón ☰.
 */
export default function AdminLayout(): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <SessionBar onMenu={() => setMenuOpen(true)} />
      <div className="grid min-h-0 flex-1 md:grid-cols-[200px_1fr]">
        <nav className="hidden space-y-1 overflow-y-auto border-r border-border bg-card p-3 md:block">
          <NavLinks />
        </nav>
        <main className="min-h-0 min-w-0 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
        >
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <nav className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-1 overflow-y-auto bg-card p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-muted-foreground">Menú</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Cerrar menú"
                className="rounded-lg p-2 hover:bg-secondary"
              >
                <X size={18} />
              </button>
            </div>
            <NavLinks onNavigate={() => setMenuOpen(false)} large />
          </nav>
        </div>
      )}
    </div>
  )
}

function NavLinks({
  onNavigate,
  large = false
}: {
  onNavigate?: () => void
  large?: boolean
}): React.JSX.Element {
  return (
    <>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-lg px-3 font-medium transition ${
              large ? 'py-3 text-base' : 'py-2 text-sm'
            } ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary'
            }`
          }
        >
          <Icon size={large ? 18 : 15} />
          {label}
        </NavLink>
      ))}
    </>
  )
}
