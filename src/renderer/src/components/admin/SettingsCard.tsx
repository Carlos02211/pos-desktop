import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Botón de acción secundaria de Configuración (probar, respaldar, cambiar…): borde + ícono. */
export const actionButtonClass =
  'inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium shadow-sm transition hover:border-primary/40 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50'

/** Tarjeta de una sección de Configuración: encabezado con ícono y descripción, luego el contenido. */
export function SettingsCard({
  icon: Icon,
  title,
  description,
  children
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b border-border bg-secondary/30 px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  )
}
