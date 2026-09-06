import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { CreditAccountListItem } from '@shared/types'
import { getSesionActiva } from '@/api/caja'
import { listCuentas, totalPorCobrar } from '@/api/cuentas'
import { CuentaDetalleModal } from '@/components/CuentaDetalleModal'
import { CuentasTable } from '@/components/CuentasTable'
import { money } from '@/lib/format'
import { socket } from '@/lib/socket'

export default function Cuentas(): React.JSX.Element {
  const navigate = useNavigate()
  const [rows, setRows] = useState<CreditAccountListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasCaja, setHasCaja] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [accounts, t, sesion] = await Promise.all([
          listCuentas({ status: 'OPEN' }),
          totalPorCobrar(),
          getSesionActiva()
        ])
        if (cancelled) return
        setRows(accounts)
        setTotal(t.total)
        setHasCaja(sesion != null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nonce])

  useEffect(() => {
    const onAbono = (): void => reload()
    socket.on('cuenta:abono', onAbono)
    return () => {
      socket.off('cuenta:abono', onAbono)
    }
  }, [reload])

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/cobrador')}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border hover:bg-secondary"
            aria-label="Volver"
          >
            <ArrowLeft size={15} />
          </button>
          <h1 className="text-lg font-bold">Cuentas por cobrar</h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total por cobrar</p>
          <p className="text-lg font-bold text-pos-warning">{money(total)}</p>
        </div>
      </header>

      {!hasCaja && (
        <p className="mb-3 rounded-lg bg-pos-warning/15 px-3 py-2 text-xs text-pos-warning">
          No tienes caja abierta: puedes consultar las cuentas pero no recibir abonos.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CuentasTable rows={rows} loading={loading} onOpen={setDetailId} />
      </div>

      {detailId !== null && (
        <CuentaDetalleModal
          accountId={detailId}
          canPay={hasCaja}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
