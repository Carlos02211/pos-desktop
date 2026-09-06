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
  Wallet
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

/** Marco del panel de administración: tema claro, barra superior + sidebar. */
export default function AdminLayout(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <SessionBar />
      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
        <nav className="space-y-1 border-r border-border bg-card p-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="min-h-0 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
