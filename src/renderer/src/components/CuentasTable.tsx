import type { CreditAccountListItem } from '@shared/types'
import { dateTime, money } from '@/lib/format'

export function CuentasTable({
  rows,
  loading,
  onOpen
}: {
  rows: CreditAccountListItem[]
  loading: boolean
  onOpen: (id: number) => void
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Origen</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Abonado</th>
            <th className="px-3 py-2 text-right">Saldo</th>
            <th className="px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                Cargando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                Sin cuentas.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onOpen(row.id)}
                className="cursor-pointer border-t border-border hover:bg-secondary/40"
              >
                <td className="px-3 py-2 font-medium">{row.customerName}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.ticketNumber ? `Ticket #${row.ticketNumber}` : 'Manual'} ·{' '}
                  {dateTime(row.createdAt)}
                </td>
                <td className="px-3 py-2 text-right">{money(row.total)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{money(row.paid)}</td>
                <td
                  className={`px-3 py-2 text-right font-semibold ${
                    row.balance > 0 ? 'text-pos-warning' : 'text-pos-success'
                  }`}
                >
                  {money(row.balance)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.status === 'OPEN'
                        ? 'bg-pos-warning/15 text-pos-warning'
                        : 'bg-pos-success/15 text-pos-success'
                    }`}
                  >
                    {row.status === 'OPEN' ? 'Pendiente' : 'Liquidada'}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
