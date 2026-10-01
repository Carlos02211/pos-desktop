import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Banknote, Plus, Printer, XCircle } from 'lucide-react'
import type { Order, PrintResult } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import {
  abrirCuenta,
  agregarACuenta,
  cancelarEncargo,
  imprimirCuenta,
  listarCuentasAbiertas
} from '@/api/encargos'
import { Modal } from '@/components/Modal'
import { useNow } from '@/hooks/useNow'
import { formatQty, money, timeOnly } from '@/lib/format'
import { cartLines, cartTotal, useCartStore } from '@/stores/cart.store'
import { useSocketStore } from '@/stores/socket.store'

const COMANDA_KEY = 'pos-imprimir-comanda'

function readComanda(): boolean {
  try {
    return localStorage.getItem(COMANDA_KEY) === '1'
  } catch {
    return false
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback
}

/** Aviso sólo si la comanda o la cuenta no salió (sin impresora activada no es error). */
function warnPrint(print: PrintResult | undefined, what: string): void {
  if (print && !print.printed && !print.skipped) {
    toast.warning(`${what} no impresa: ${print.error ?? 'impresora no disponible'}`)
  }
}

/**
 * Cuentas abiertas (mesas): lo que piden se va agregando y se cobra al final. Desde aquí se
 * abre una cuenta nueva con lo del carrito, se agrega lo del carrito a una abierta, se imprime
 * la pre-cuenta o se pasa al carrito para cobrarla.
 */
export function MesasModal({
  onClose,
  onCharge
}: {
  onClose: () => void
  /** Pasar la cuenta al carrito para cobrarla (o corregirla). */
  onCharge: (order: Order) => void
}): React.JSX.Element {
  const items = useCartStore((s) => s.items)
  const delivery = useCartStore((s) => s.delivery)
  const appendTo = useCartStore((s) => s.appendTo)
  const clear = useCartStore((s) => s.clear)
  // Lo del carrito se puede mandar a una cuenta si es una venta nueva (no una entrega/agregado).
  const canSend = items.length > 0 && !delivery && !appendTo
  const cartBusy = items.length > 0

  const [tabs, setTabs] = useState<Order[] | null>(null)
  const [name, setName] = useState('')
  const [comanda, setComanda] = useState(readComanda)
  const [busy, setBusy] = useState(false)
  const [canceling, setCanceling] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)
  const revision = useSocketStore((s) => s.revision)
  const now = useNow(30_000)

  useEffect(() => {
    let cancelled = false
    listarCuentasAbiertas()
      .then((list) => {
        if (!cancelled) setTabs(list)
      })
      .catch((err) => {
        if (cancelled) return
        toast.error(errorText(err, 'No se pudieron cargar las cuentas'))
        setTabs([])
      })
    return () => {
      cancelled = true
    }
  }, [revision, nonce])

  function toggleComanda(on: boolean): void {
    setComanda(on)
    try {
      localStorage.setItem(COMANDA_KEY, on ? '1' : '0')
    } catch {
      /* sin almacenamiento: sólo dura mientras está abierta la ventana */
    }
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const open = (): Promise<void> =>
    run(async () => {
      try {
        const res = await abrirCuenta({
          name: name.trim(),
          items: canSend ? cartLines(items) : [],
          printComanda: comanda && canSend
        })
        toast.success(
          `Cuenta "${res.order.customerName}" abierta` +
            (canSend ? ` con ${money(res.order.total)}` : '')
        )
        warnPrint(res.print, 'Comanda')
        if (canSend) {
          clear()
          onClose()
          return
        }
        setName('')
        setNonce((n) => n + 1)
      } catch (err) {
        toast.error(errorText(err, 'No se pudo abrir la cuenta'))
      }
    })

  const send = (tab: Order): Promise<void> =>
    run(async () => {
      try {
        const added = cartTotal(items)
        const res = await agregarACuenta(tab.id, { items: cartLines(items), printComanda: comanda })
        toast.success(
          `Se agregaron ${money(added)} a "${tab.customerName}" · lleva ${money(res.order.total)}`
        )
        warnPrint(res.print, 'Comanda')
        clear()
        onClose()
      } catch (err) {
        toast.error(errorText(err, 'No se pudo agregar a la cuenta'))
      }
    })

  const printTab = (tab: Order): Promise<void> =>
    run(async () => {
      try {
        const r = await imprimirCuenta(tab.id)
        if (r.printed) toast.success(`Cuenta de "${tab.customerName}" impresa`)
        else if (r.skipped) toast.info('No hay impresora activada.')
        else toast.error(r.error ?? 'No se pudo imprimir')
      } catch (err) {
        toast.error(errorText(err, 'No se pudo imprimir'))
      }
    })

  const cancel = (tab: Order): Promise<void> =>
    run(async () => {
      try {
        await cancelarEncargo(tab.id, {})
        toast.success(`Cuenta "${tab.customerName}" cancelada`)
        setCanceling(null)
        setNonce((n) => n + 1)
      } catch (err) {
        toast.error(errorText(err, 'No se pudo cancelar'))
      }
    })

  const nowS = now.getTime() / 1000

  return (
    <Modal title="Mesas y cuentas abiertas" onClose={onClose} busy={busy} wide>
      <form
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void open()
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Mesa 4, Don Pepe, Barra…"
          aria-label="Nombre de la cuenta nueva"
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={16} />
          {canSend ? `Abrir con lo del carrito (${money(cartTotal(items))})` : 'Abrir cuenta'}
        </button>
        <label className="flex w-full items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={comanda}
            onChange={(e) => toggleComanda(e.target.checked)}
          />
          Imprimir comanda para la cocina al agregar (lo nuevo, sin precios)
        </label>
      </form>

      {tabs === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : tabs.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay cuentas abiertas. Escribe la mesa o el nombre y toca &quot;Abrir cuenta&quot;.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {tabs.map((t) => {
            const mins = Math.max(0, Math.floor((nowS - t.pickupAt) / 60))
            const since = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`
            return (
              <div key={t.id} className="flex flex-col rounded-xl border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-base font-bold">{t.customerName}</p>
                  <p className="shrink-0 text-lg font-bold tabular-nums">{money(t.total)}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Desde las {timeOnly(t.pickupAt)} · {since} · abrió {t.userName}
                </p>
                <ul className="mt-1.5 flex-1 space-y-0.5 text-sm">
                  {t.items.length === 0 && (
                    <li className="text-muted-foreground">Todavía no piden nada.</li>
                  )}
                  {t.items.map((it, i) => (
                    <li key={i}>
                      {formatQty(it.quantity, it.unit)} × {it.name}
                      {it.note && (
                        <span className="ml-1 text-xs text-pos-warning italic">› {it.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {canceling === t.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="mr-1">¿Cancelar la cuenta? Se pierde lo anotado.</span>
                    <button
                      disabled={busy}
                      onClick={() => void cancel(t)}
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
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {canSend && (
                      <button
                        disabled={busy}
                        onClick={() => void send(t)}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                      >
                        <Plus size={15} /> Agregar lo del carrito
                      </button>
                    )}
                    <button
                      disabled={busy || t.items.length === 0}
                      onClick={() => void printTab(t)}
                      title="Imprimir la cuenta para que el cliente vea cuánto lleva"
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-secondary disabled:opacity-40"
                    >
                      <Printer size={14} /> Cuenta
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setCanceling(t.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:border-destructive hover:text-destructive disabled:opacity-40"
                    >
                      <XCircle size={14} /> Cancelar
                    </button>
                    <button
                      disabled={busy || cartBusy}
                      onClick={() => onCharge(t)}
                      title={
                        cartBusy
                          ? 'Termina o vacía la venta del carrito primero'
                          : 'Pasar al carrito para cobrar (ahí puedes quitar o corregir)'
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-pos-success px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                    >
                      <Banknote size={14} /> Cobrar
                    </button>
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
