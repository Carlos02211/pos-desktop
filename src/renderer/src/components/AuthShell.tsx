import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DatabaseBackup, Loader2, Radio, WifiOff } from 'lucide-react'
import logo from '@/assets/logo-spartan.webp'
import { PointerGlow } from '@/components/PointerGlow'
import { cn } from '@/lib/utils'

/**
 * Pantalla de Login y Activación: panel de marca (logo, puntos fuertes, reloj) a la
 * izquierda en pantallas anchas y la tarjeta del formulario a la derecha. En tabletas y
 * celulares queda en una columna con el logo arriba.
 */

const FEATURES = [
  { icon: Radio, text: 'Varias cajas en tiempo real' },
  { icon: WifiOff, text: 'Funciona sin internet' },
  { icon: DatabaseBackup, text: 'Respaldos automáticos' }
]

/** "Jueves, 24 de septiembre" (sólo la primera letra en mayúscula). */
function fechaLarga(d: Date): string {
  const s = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  return (
    <div>
      <p className="text-4xl font-semibold tabular-nums tracking-tight text-white">
        {now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="mt-1 text-sm text-slate-400">{fechaLarga(now)}</p>
    </div>
  )
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}): React.JSX.Element {
  return (
    <div className="cobrador relative min-h-dvh overflow-hidden bg-[#0b1020] text-foreground">
      {/* Fondo: cuadrícula tenue + dos halos con los colores del logo */}
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="auth-breathe pointer-events-none absolute -left-32 -top-32 h-[34rem] w-[34rem] rounded-full bg-cyan-500/20 blur-[120px]"
      />
      <div
        aria-hidden
        className="auth-breathe pointer-events-none absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full bg-blue-600/20 blur-[120px] [animation-delay:-3.5s]"
      />

      <PointerGlow />

      <div className="relative z-10 mx-auto grid min-h-dvh max-w-6xl content-center items-center gap-8 px-6 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-12">
        {/* Marca */}
        <aside className="auth-rise text-center lg:text-left">
          <img
            src={logo}
            alt="SpArTaN Tech"
            draggable={false}
            className="mx-auto h-32 w-auto select-none drop-shadow-[0_10px_30px_rgba(34,211,238,0.28)] sm:h-40 lg:mx-0 lg:h-56"
          />
          <h2 className="mt-6 hidden text-3xl font-bold leading-tight text-white lg:block">
            Tu punto de venta,
            <span className="block bg-gradient-to-r from-cyan-300 to-sky-500 bg-clip-text text-transparent">
              siempre listo.
            </span>
          </h2>
          <ul className="mt-6 hidden space-y-3 lg:block">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-slate-300">
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <div className="mt-10 hidden border-t border-white/10 pt-6 lg:block">
            <Clock />
          </div>
        </aside>

        {/* Formulario */}
        <main className="auth-rise auth-rise-2 mx-auto w-full max-w-sm lg:mx-0 lg:justify-self-end">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 p-7 shadow-2xl shadow-black/50 backdrop-blur-xl">
            {/* Línea de acento */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent"
            />
            <h1 className="text-2xl font-bold text-white">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-xs text-slate-500">{footer}</div>}
        </main>
      </div>
    </div>
  )
}

export function TextField({
  label,
  hint,
  icon,
  trailing,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: ReactNode
  /** Ícono a la izquierda, dentro del campo. */
  icon?: ReactNode
  /** Botón/elemento a la derecha, dentro del campo (p. ej. ver contraseña). */
  trailing?: ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-200">{label}</span>
      <span className="relative block">
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
            {icon}
          </span>
        )}
        <input
          {...props}
          className={cn(
            'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60 focus:ring-4 focus:ring-cyan-400/10 disabled:opacity-60',
            icon && 'pl-10',
            trailing && 'pr-11'
          )}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</span>
        )}
      </span>
      {hint && <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function SubmitButton({
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }): React.JSX.Element {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_8px_30px_-8px_rgba(34,211,238,0.6)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Procesando…
        </>
      ) : (
        children
      )}
    </button>
  )
}

export function ErrorText({ children }: { children: ReactNode }): React.JSX.Element | null {
  if (!children) return null
  return (
    <p
      className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
      role="alert"
    >
      {children}
    </p>
  )
}
