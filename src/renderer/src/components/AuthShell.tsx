import type { ReactNode } from 'react'
import logo from '@/assets/logo-spartan.webp'

/** Contenedor centrado para Login y Activación: logo de SpArTaN Tech + tarjeta. */
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
    <div className="cobrador relative flex min-h-full items-center justify-center overflow-hidden bg-background p-6 text-foreground">
      {/* Halo detrás del logo: da profundidad sin competir con el formulario. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[18%] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-sky-400/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <img
            src={logo}
            alt="SpArTaN Tech"
            className="mx-auto h-36 w-auto drop-shadow-[0_8px_24px_rgba(56,189,248,0.25)] select-none"
            draggable={false}
          />
          <h1 className="mt-5 text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="rounded-xl border border-white/10 bg-card/80 p-6 shadow-2xl shadow-black/40 backdrop-blur">
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-xs text-muted-foreground">{footer}</div>}
      </div>
    </div>
  )
}

export function TextField({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
      />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
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
      className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? 'Procesando…' : children}
    </button>
  )
}

export function ErrorText({ children }: { children: ReactNode }): React.JSX.Element | null {
  if (!children) return null
  return (
    <p className="rounded-lg bg-pos-danger/15 px-3 py-2 text-xs text-pos-danger" role="alert">
      {children}
    </p>
  )
}
