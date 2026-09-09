import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Modal simple con overlay. Cierra con Escape o clic fuera, salvo que `busy`
 * esté activo (p. ej. una venta en curso — no se puede cancelar a medias).
 */
export function Modal({
  title,
  onClose,
  busy = false,
  children
}: {
  title: string
  onClose: () => void
  busy?: boolean
  children: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
