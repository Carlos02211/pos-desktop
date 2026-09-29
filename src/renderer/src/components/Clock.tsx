import { Clock as ClockIcon } from 'lucide-react'
import { useNow } from '@/hooks/useNow'

/** Reloj en vivo de la barra superior: hora con segundos y fecha corta. */
export function Clock(): React.JSX.Element {
  const now = useNow(1000)
  return (
    <span className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-1">
      <ClockIcon size={16} className="shrink-0 text-muted-foreground" />
      <span className="text-base font-semibold tabular-nums">
        {now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">{fechaCorta(now)}</span>
    </span>
  )
}

/** "Martes 29 sep" (sólo la primera letra en mayúscula). */
function fechaCorta(d: Date): string {
  const s = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, '').replace(',', '')
}
