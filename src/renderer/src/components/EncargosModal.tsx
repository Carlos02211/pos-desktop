import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PackageCheck, Phone, Printer, XCircle } from 'lucide-react'
import type { Order } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { cancelarEncargo, imprimirEncargo, listarEncargos } from '@/api/encargos'
import { Modal } from '@/components/Modal'
import { useNow } from '@/hooks/useNow'
import { formatQty, money, timeOnly } from '@/lib/format'
import { useSocketStore } from '@/stores/socket.store'

const STATUS_LABEL: Record<Order['status'], string> = {
  PENDING: 'Pendiente',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado'
}

/** "Hoy 2:30 p. m." / "Mañana 10:00 a. m." / "sáb 4 oct, 1:00 p. m." */
function pickupLabel(unix: number, now: Date): string {
  const d = new Date(unix * 1000)
  const day = (offset: number): string => {
    const x = new Date(now)
    x.setDate(x.getDate() + offset)
    return x.toDateString()
  }
  if (d.toDateString() === day(0)) return `Hoy ${timeOnly(unix)}`
  if (d.toDateString() === day(1)) return `Mañana ${timeOnly(unix)}`
  if (d.toDateString() === day(-1)) return `Ayer ${timeOnly(unix)}`
  return `${d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeOnly(unix)}`
}

/**
 * Encargos del negocio: los pendientes por hora de entrega (los atrasados en rojo, los de la
 * próxima hora en amarillo) y los ya entregados o cancelados.
 */
export function EncargosModal({
  cartBusy,
  onClose,
  onDeliver
}: {
  /** Hay una venta a medias en el carrito: no se puede cargar un encargo encima. */
  cartBusy: boolean
  onClose: () => void
  onDeliver: (order: Order) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'PENDING' | 'CLOSED'>('PENDING')
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [canceling, setCanceling] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const revision = useSocketStore((s) => s.revision)
  const now = useNow(30_000)

  // `nonce` recarga después de cancelar; `revision`, cuando otra caja cambia un encargo.
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    listarEncargos(tab)
      .then((list) => {
        if (!cancelled) setOrders(list)
      })
      .catch((err) => {
        if (cancelled) return
        toast.error(err instanceof ApiRequestError ? err.message : 'No se pudieron cargar')
        setOrders([])
      })
    return () => {
      cancelled = true
    }
  }, [tab, revision, nonce])

  async function cancel(order: Order, refund: boolean): Promise<void> {
    setBusy(true)
    try {
      await cancelarEncargo(order.id, { refund })
      toast.success(
        `Encargo #${order.id} cancelado` +
          (refund ? ` · regresa ${money(order.deposit)} de la caja` : '')
      )
      setCanceling(null)
      setNonce((n) => n + 1)
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo cancelar')
    } finally {
      setBusy(false)
    }
  }

  async function reprint(order: Order): Promise<void> {
    try {
      const r = await imprimirEncargo(order.id)
      if (r.printed) toast.success(`Comprobante del encargo #${order.id} impreso`)
      else if (r.skipped) toast.info('No hay impresora activada.')
      else toast.error(r.error ?? 'No se pudo imprimir')
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'No se pudo imprimir')
    }
  }

  const nowS = now.getTime() / 1000

  return (
    <Modal title="Encargos" onClose={onClose} busy={busy} wide>
      <div className="mb-3 flex gap-1.5">
        {(
          [
            ['PENDING', 'Pendientes'],
            ['CLOSED', 'Entregados y cancelados']
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              tab === value
                ? 'border-ring bg-primary text-primary-foreground'
                : 'border-input bg-secondary hover:brightness-125'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {orders === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {tab === 'PENDING'
            ? 'No hay encargos pendientes. Arma el pedido en el carrito y toca "Encargo".'
            : 'Todavía no hay encargos entregados ni cancelados.'}
        </p>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const late = o.status === 'PENDING' && o.pickupAt < nowS
            const soon = o.status === 'PENDING' && !late && o.pickupAt - nowS <= 3600
            const rest = Math.round((o.total - o.deposit) * 100) / 100
            return (
              <div
                key={o.id}
                className={`rounded-xl border p-3 ${
                  late
                    ? 'border-pos-danger/60 bg-pos-danger/10'
                    : soon
                      ? 'border-pos-warning/60 bg-pos-warning/10'
                      : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-semibold">
                    #{o.id} · {o.customerName}
                    {o.phone && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <Phone size={12} /> {o.phone}
                      </span>
                    )}
                  </p>
                  <p
                    className={`text-sm font-semibold ${
                      late ? 'text-pos-danger' : soon ? 'text-pos-warning' : ''
                    }`}
                  >
                    {o.status === 'PENDING'
                      ? `${late ? 'Atrasado · ' : ''}${pickupLabel(o.pickupAt, now)}`
                      : `${STATUS_LABEL[o.status]} · ${pickupLabel(o.closedAt ?? o.pickupAt, now)}`}
                  </p>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-sm">
                  {o.items.map((it, i) => (
                    <li key={i}>
                      {formatQty(it.quantity, it.unit)} × {it.name}
                      {it.note && (
                        <span className="ml-1 text-xs text-pos-warning italic">› {it.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {o.notes && <p className="mt-1 text-xs text-muted-foreground">Nota: {o.notes}</p>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    Total {money(o.total)}
                    {o.deposit > 0 && (
                      <>
                        {' '}
                        · anticipo {money(o.deposit)} ·{' '}
                        <strong>{rest > 0 ? `resta ${money(rest)}` : 'pagado'}</strong>
                      </>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">Lo tomó {o.userName}</span>
                  </p>
                  {o.status === 'PENDING' && canceling !== o.id && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => void reprint(o)}
                        title="Imprimir el comprobante otra vez"
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-secondary"
                      >
                        <Printer size={14} /> Imprimir
                      </button>
                      <button
                        onClick={() => setCanceling(o.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:border-destructive hover:text-destructive"
                      >
                        <XCircle size={14} /> Cancelar
                      </button>
                      <button
                        onClick={() => onDeliver(o)}
                        disabled={cartBusy}
                        title={
                          cartBusy
                            ? 'Termina o vacía la venta del carrito primero'
                            : 'Pasar al carrito para cobrar lo que resta'
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-pos-success px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                      >
                        <PackageCheck size={14} /> Entregar
                      </button>
                    </div>
                  )}
                </div>
                {canceling === o.id && (
                  <div className="mt-2 rounded-lg border border-border bg-secondary/40 p-2 text-sm">
                    {o.deposit > 0 ? (
                      <>
                        <p className="mb-2">
                          Dejó {money(o.deposit)} de anticipo. ¿Se lo regresas?
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            disabled={busy}
                            onClick={() => void cancel(o, true)}
                            className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Sí, sale {money(o.deposit)} de la caja
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void cancel(o, false)}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          >
                            No, se queda el anticipo
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => setCanceling(null)}
                            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground"
                          >
                            Volver
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1">¿Cancelar el encargo #{o.id}?</span>
                        <button
                          disabled={busy}
                          onClick={() => void cancel(o, false)}
                          className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Sí, cancelar
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setCanceling(null)}
                          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground"
                        >
                          Volver
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
