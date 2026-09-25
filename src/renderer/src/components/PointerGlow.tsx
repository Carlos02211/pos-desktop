import { useEffect, useRef } from 'react'

/**
 * Foco de luz que sigue al puntero (mismo efecto que el landing de pos-cafeteria): un
 * círculo con degradado radial cian que ilumina el fondo y sigue al mouse con un poco de
 * inercia. Va DETRÁS del contenido (el padre pone el contenido en `z-10`), así ilumina la
 * cuadrícula sin teñir el formulario. Sólo con mouse (no en pantallas táctiles) y sin
 * `prefers-reduced-motion`.
 */
const SIZE = 420

export function PointerGlow(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const glow = ref.current
    if (!glow) return
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduced) return

    let mx = window.innerWidth / 2
    let my = window.innerHeight / 2
    let gx = mx
    let gy = my
    let raf = 0

    const loop = (): void => {
      gx += (mx - gx) * 0.14
      gy += (my - gy) * 0.14
      glow.style.transform = `translate3d(${gx - SIZE / 2}px, ${gy - SIZE / 2}px, 0)`
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onMove = (e: MouseEvent): void => {
      mx = e.clientX
      my = e.clientY
      glow.style.opacity = '1'
    }
    const onLeave = (): void => {
      glow.style.opacity = '0'
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-0 rounded-full opacity-0 transition-opacity duration-500 will-change-transform"
      style={{
        width: SIZE,
        height: SIZE,
        background: 'radial-gradient(circle, rgb(34 211 238 / 0.22) 0%, transparent 70%)'
      }}
    />
  )
}
