import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { API_BASE_URL, ApiRequestError } from '@/api/client'
import { subirLogoTicket } from '@/api/admin'
import { makeTicketLogo } from '@/lib/ticket-logo'

/**
 * "Imprimir el logo en el ticket": al activarlo se arma la versión blanco y negro del logo
 * del negocio (ver makeTicketLogo) y se sube; la vista previa muestra cómo va a salir.
 * `ticket_logo` se guarda con "Guardar cambios"; la imagen se sube al momento.
 */
export function TicketLogoOption({
  logoPath,
  enabled,
  ticketLogoPath,
  onEnabledChange,
  onTicketLogoPath
}: {
  logoPath: string
  enabled: boolean
  ticketLogoPath: string
  onEnabledChange: (on: boolean) => void
  onTicketLogoPath: (path: string) => void
}): React.JSX.Element {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function toggle(on: boolean): Promise<void> {
    setError('')
    if (!on) {
      onEnabledChange(false)
      return
    }
    if (!logoPath) {
      setError('Primero subí el logo del negocio (arriba, en "Negocio y ticket").')
      return
    }
    setWorking(true)
    try {
      const source = await (await fetch(`${API_BASE_URL}/uploads/${logoPath}`)).blob()
      const res = await subirLogoTicket(await makeTicketLogo(source))
      onTicketLogoPath(res.path)
      onEnabledChange(true)
    } catch (err) {
      setError(
        err instanceof ApiRequestError || err instanceof Error
          ? err.message
          : 'No se pudo preparar el logo del ticket.'
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          disabled={working}
          onChange={(e) => void toggle(e.target.checked)}
          className="h-4 w-4"
        />
        Imprimir el logo arriba del ticket
        {working && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Las impresoras de tickets imprimen en blanco y negro: los colores salen como puntos.
        Funciona mejor con logos simples y de buen contraste.
      </p>
      {enabled && ticketLogoPath && (
        <div className="mt-3">
          <span className="mb-1 block text-xs text-muted-foreground">Así va a salir impreso:</span>
          <div className="inline-block rounded-md border border-border bg-white p-3 shadow-sm">
            <img
              src={`${API_BASE_URL}/uploads/${ticketLogoPath}`}
              alt="Vista previa del logo en el ticket"
              className="max-h-24 w-auto [image-rendering:pixelated]"
            />
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
