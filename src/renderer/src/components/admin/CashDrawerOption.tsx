import { useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { ApiRequestError } from '@/api/client'
import { probarCajon } from '@/api/admin'
import { cn } from '@/lib/utils'

/**
 * "Tengo cajón de dinero": el cajón va en el puerto RJ11 de la impresora y se abre cuando
 * entra o sale efectivo (venta, enganche, abono, retiro/ingreso) y con el botón del cobrador.
 * `cash_drawer` se guarda con "Guardar cambios"; la prueba usa la impresora que se ve en
 * pantalla aunque todavía no esté guardada.
 */
export function CashDrawerOption({
  enabled,
  printerInterface,
  onEnabledChange
}: {
  enabled: boolean
  printerInterface: string
  onEnabledChange: (on: boolean) => void
}): React.JSX.Element {
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)

  async function runTest(): Promise<void> {
    setTesting(true)
    setTest(null)
    try {
      const r = await probarCajon(printerInterface)
      setTest(
        r.opened
          ? { ok: true, msg: 'Orden enviada. Si el cajón no abrió, revisa el cable RJ11.' }
          : { ok: false, msg: r.error ?? 'No se pudo abrir el cajón.' }
      )
    } catch (err) {
      setTest({
        ok: false,
        msg: err instanceof ApiRequestError ? err.message : 'No se pudo abrir el cajón.'
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="h-4 w-4"
        />
        Tengo cajón de dinero conectado a la impresora
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Se abre solo al cobrar en efectivo, al recibir un abono en efectivo y en retiros o ingresos.
        El cobrador también tiene un botón para abrirlo con la caja abierta.
      </p>
      {enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || !printerInterface.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            {testing ? 'Abriendo…' : 'Probar cajón'}
          </button>
          {test && (
            <span
              className={cn(
                'flex items-start gap-1.5 text-sm',
                test.ok ? 'text-pos-success' : 'text-destructive'
              )}
            >
              {test.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="break-words">{test.msg}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
