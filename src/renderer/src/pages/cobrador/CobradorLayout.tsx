import { Outlet } from 'react-router-dom'
import { SessionBar } from '@/components/SessionBar'

/** Marco del área de cobrador: tema oscuro + barra de sesión. */
export default function CobradorLayout(): React.JSX.Element {
  return (
    <div className="cobrador flex h-full flex-col bg-background text-foreground">
      <SessionBar />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
