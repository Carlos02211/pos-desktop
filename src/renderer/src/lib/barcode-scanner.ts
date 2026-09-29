import { useEffect, useRef } from 'react'

/**
 * Lector de código de barras en modo teclado (HID): "teclea" el código en milisegundos y
 * cierra con Enter. Se escucha en `window` para que funcione aunque el foco esté en un botón
 * del grid, donde ese Enter volvería a agregar el último producto tocado.
 *
 * Una persona no teclea a menos de ~80 ms entre teclas; el lector va por debajo de 20 ms.
 * Si el foco está en un campo de texto se deja pasar: ese campo decide qué hacer con el Enter.
 */
const MAX_GAP_MS = 50
const MIN_LENGTH = 4

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function useBarcodeScanner(onScan: (code: string) => void, enabled: boolean): void {
  const onScanRef = useRef(onScan)
  useEffect(() => {
    onScanRef.current = onScan
  })

  useEffect(() => {
    if (!enabled) return
    let buffer = ''
    let last = 0

    const onKeyDown = (e: KeyboardEvent): void => {
      if (isEditable(e.target) || e.ctrlKey || e.altKey || e.metaKey) {
        buffer = ''
        return
      }
      const now = performance.now()
      if (now - last > MAX_GAP_MS) buffer = ''
      last = now

      if (e.key === 'Enter') {
        if (buffer.length >= MIN_LENGTH) {
          e.preventDefault()
          e.stopPropagation()
          onScanRef.current(buffer)
        }
        buffer = ''
      } else if (e.key.length === 1) {
        buffer += e.key
      }
    }

    // Fase de captura: se ve el Enter antes de que el botón con foco lo convierta en clic.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
