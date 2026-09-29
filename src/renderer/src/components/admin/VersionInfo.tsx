import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { PingResponse } from '@shared/types'
import { getPing } from '@/api/admin'

function fmt(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Pie de Configuración: versión del servidor y de las pantallas. Si no coinciden, al
 * actualizar se copió sólo una parte (server.cjs o public\) o el navegador guardó lo viejo.
 */
export function VersionInfo(): React.JSX.Element {
  const [server, setServer] = useState<PingResponse | null>(null)
  const ui = __POS_BUILD__

  useEffect(() => {
    let cancelled = false
    getPing()
      .then((p) => !cancelled && setServer(p))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const mismatch = server != null && server.commit !== ui.commit

  return (
    <div className="space-y-1 text-center text-xs text-muted-foreground">
      <p>
        Versión del servidor <code className="font-semibold">{server?.commit ?? '…'}</code>
        {server?.builtAt && <> · compilado el {fmt(server.builtAt)}</>}
      </p>
      <p>
        Versión de las pantallas <code className="font-semibold">{ui.commit}</code>
        {ui.date && <> · compilado el {fmt(ui.date)}</>}
      </p>
      {mismatch && (
        <p className="mx-auto flex max-w-md items-start justify-center gap-1.5 rounded-lg bg-pos-warning/10 p-2 text-left text-pos-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No coinciden: se actualizó sólo una parte (server.cjs o la carpeta public) o el
            navegador guardó las pantallas viejas. Recarga con Ctrl+F5.
          </span>
        </p>
      )}
    </div>
  )
}
