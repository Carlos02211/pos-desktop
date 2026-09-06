import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'
import type { SaleWithItems } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { getVentaDetalle, reimprimirTicket } from '@/api/admin'
import { Modal } from '@/components/Modal'
import { dateTime, money, paymentLabel } from '@/lib/format'

export function VentaDetalleModal({
  saleId,
  onClose
}: {
  saleId: number
  onClose: () => void
}): React.JSX.Element {
  const [sale, setSale] = useState<SaleWithItems | null>(null)
  const [error, setError] = useState('')
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let cancelled = false
    getVentaDetalle(saleId)
      .then((s) => !cancelled && setSale(s))
      .catch(() => !cancelled && setError('No se pudo cargar la venta'))
    return () => {
      cancelled = true
    }
  }, [saleId])

  async function reprint(): Promise<void> {
    setPrinting(true)
    try {
      await reimprimirTicket(saleId)
      toast.success('Ticket reenviado a la impresora')
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo reimprimir')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Modal title={sale ? `Ticket #${sale.ticketNumber}` : 'Venta'} onClose={onClose}>
      {error && <p className="text-sm text-pos-danger">{error}</p>}
      {!sale && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {sale && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>{dateTime(sale.createdAt)}</span>
            <span>{sale.userName}</span>
          </div>

          <div className="rounded-lg border border-border">
            <table className="w-full">
              <tbody>
                {sale.items.map((it) => (
                  <tr key={it.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">
                      {it.quantity} × {it.name}
                    </td>
                    <td className="px-3 py-1.5 text-right">{money(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{money(sale.total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Método</span>
              <span>{paymentLabel(sale.paymentMethod)}</span>
            </div>
            {sale.paymentMethod === 'CASH' && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>Pagó</span>
                  <span>{money(sale.amountPaid ?? 0)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Cambio</span>
                  <span>{money(sale.change ?? 0)}</span>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => void reprint()}
            disabled={printing}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary disabled:opacity-50"
          >
            <Printer size={14} />
            {printing ? 'Enviando…' : 'Reimprimir ticket'}
          </button>
        </div>
      )}
    </Modal>
  )
}
