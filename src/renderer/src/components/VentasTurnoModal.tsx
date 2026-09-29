import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { TurnSale } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { reimprimirVenta, ventasDelTurno } from '@/api/ventas'
import { Modal } from '@/components/Modal'
import { money, paymentLabel, timeOnly } from '@/lib/format'
import { useAuthStore } from '@/stores/auth.store'
import type { AppendTarget } from '@/stores/cart.store'

/**
 * Ventas del turno abierto: completar una venta con lo que el cliente olvidó (mismo folio) o
 * reimprimir el ticket. El cobrador sólo reimprime su último ticket; el admin, cualquiera.
 */
export function VentasTurnoModal({
  onClose,
  onAppend
}: {
  onClose: () => void
  onAppend: (target: AppendTarget) => void
}): React.JSX.Element {
  const isAdmin = useAuthStore((s) => s.user?.role === 'ADMIN')
  const [sales, setSales] = useState<TurnSale[] | null>(null)
  const [error, setError] = useState('')
  const [printingId, setPrintingId] = useState<number | null>(null)

  useEffect(() => {
    ventasDelTurno()
      .then(setSales)
      .catch((err) =>
        setError(err instanceof ApiRequestError ? err.message : 'No se pudieron cargar las ventas.')
      )
  }, [])

  async function reprint(sale: TurnSale): Promise<void> {
    setPrintingId(sale.id)
    try {
      await reimprimirVenta(sale.id)
      toast.success(`Ticket #${sale.ticketNumber} reimpreso`)
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo reimprimir')
    } finally {
      setPrintingId(null)
    }
  }

  return (
    <Modal title="Ventas del turno" onClose={onClose}>
      {error && <p className="text-sm text-pos-danger">{error}</p>}
      {!sales && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {sales?.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no hay ventas en este turno.</p>
      )}

      {sales && sales.length > 0 && (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          <p className="text-xs text-muted-foreground">
            ¿El cliente olvidó algo? Usa <strong>Agregar productos</strong>: se suma a la misma
            venta, se cobra con el mismo método y sale un ticket actualizado.
          </p>
          {sales.map((s) => (
            <div key={s.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">
                  #{s.ticketNumber}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {timeOnly(s.createdAt)} · {paymentLabel(s.paymentMethod)} · {s.itemCount} art.
                  </span>
                </span>
                <span className="font-semibold">{money(s.total)}</span>
              </div>
              {(s.customerName || isAdmin) && (
                <p className="text-xs text-muted-foreground">
                  {[s.customerName, isAdmin ? `caja de ${s.userName}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() =>
                    onAppend({
                      saleId: s.id,
                      ticketNumber: s.ticketNumber,
                      paymentMethod: s.paymentMethod,
                      total: s.total,
                      customerName: s.customerName
                    })
                  }
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                >
                  Agregar productos
                </button>
                {s.canReprint && (
                  <button
                    onClick={() => void reprint(s)}
                    disabled={printingId != null}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition hover:bg-secondary disabled:opacity-50"
                  >
                    {printingId === s.id ? 'Enviando…' : 'Reimprimir'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!isAdmin && sales.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Sólo se puede reimprimir el último ticket. Los anteriores, pídelos al administrador.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
