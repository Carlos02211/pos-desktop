import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import type { TicketLine } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { ticketDeEjemplo, ticketDeVenta } from '@/api/ventas'
import { Modal } from '@/components/Modal'

/** Papel de 80 mm: 72 mm imprimibles = 48 columnas → cada carácter mide 1.5 mm. */
const PAPER_MM = 80
const MARGIN_MM = 4
const FONT_MM = 2.5 // Courier: el avance de un carácter es 0.6 em → 1.5 mm
const LINE_MM = 3.4

/**
 * Vista previa del ticket, idéntica a lo que imprime la térmica (el servidor arma los mismos
 * renglones para ambas). "Imprimir o guardar PDF" imprime SÓLO el ticket, a 80 mm de ancho:
 * en el diálogo se elige "Guardar como PDF" (respeta el tamaño) o "Microsoft Print to PDF".
 */
export function TicketPreviewModal({
  saleId,
  title,
  onClose
}: {
  /** Venta a mostrar (sale marcada como copia). Sin `saleId`: ticket de ejemplo. */
  saleId?: number
  title: string
  onClose: () => void
}): React.JSX.Element {
  const [lines, setLines] = useState<TicketLine[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(saleId == null ? ticketDeEjemplo() : ticketDeVenta(saleId))
      .then((r) => !cancelled && setLines(r.lines))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiRequestError ? err.message : 'No se pudo armar el ticket.')
      )
    return () => {
      cancelled = true
    }
  }, [saleId])

  // Alto del papel según los renglones (un ticket es una tira, no una hoja carta).
  const heightMm = Math.ceil((lines?.length ?? 0) * LINE_MM + MARGIN_MM * 2 + 8)

  return (
    <Modal title={title} onClose={onClose}>
      {error && <p className="text-sm text-pos-danger">{error}</p>}
      {!lines && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {lines && (
        <div className="space-y-3">
          <div className="max-h-[60vh] overflow-auto rounded-lg bg-neutral-300 p-4">
            <TicketPaper lines={lines} fontSize="11.5px" />
          </div>
          <button
            onClick={() => window.print()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Printer size={15} /> Imprimir o guardar PDF
          </button>
          <p className="text-xs text-muted-foreground">
            En el diálogo elige <strong>Guardar como PDF</strong> (sale a 80 mm, como el ticket
            real) o <strong>Microsoft Print to PDF</strong> (sale en una hoja carta).
          </p>
          {createPortal(
            <div id="ticket-print">
              <style>{`
                #ticket-print { display: none; }
                @media print {
                  @page { size: ${PAPER_MM}mm ${heightMm}mm; margin: 0; }
                  html, body { background: #fff !important; }
                  body > *:not(#ticket-print) { display: none !important; }
                  #ticket-print { display: block; }
                }
              `}</style>
              <TicketPaper lines={lines} fontSize={`${FONT_MM}mm`} print />
            </div>,
            document.body
          )}
        </div>
      )}
    </Modal>
  )
}

function TicketPaper({
  lines,
  fontSize,
  print = false
}: {
  lines: TicketLine[]
  fontSize: string
  print?: boolean
}): React.JSX.Element {
  return (
    <div
      style={{
        fontFamily: '"Courier New", Courier, "Liberation Mono", monospace',
        fontSize,
        lineHeight: print ? `${LINE_MM}mm` : 1.35,
        width: print ? `${PAPER_MM}mm` : 'max-content',
        padding: print ? `${MARGIN_MM}mm` : '1.25em 1em',
        boxSizing: 'border-box',
        margin: print ? 0 : '0 auto',
        background: '#fff',
        color: '#000',
        boxShadow: print ? undefined : '0 2px 10px rgba(0,0,0,0.25)'
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            width: '48ch',
            whiteSpace: 'pre',
            textAlign: line.align,
            fontWeight: line.bold ? 700 : 400
          }}
        >
          {line.text || ' '}
        </div>
      ))}
    </div>
  )
}
