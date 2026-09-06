import { useCallback, useEffect, useState } from 'react'
import type { PingResponse } from '@shared/types'
import { ping } from './api/ping'
import { ApiRequestError } from './api/client'

type State =
  | { status: 'loading' }
  | { status: 'ok'; data: PingResponse }
  | { status: 'error'; message: string }

function toState(result: PingResponse | unknown, ok: boolean): State {
  if (ok) return { status: 'ok', data: result as PingResponse }
  const err = result
  const message =
    err instanceof ApiRequestError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : 'Error desconocido'
  return { status: 'error', message }
}

function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  const recheck = useCallback(() => {
    setState({ status: 'loading' })
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    ping('renderer')
      .then((data) => !cancelled && setState(toState(data, true)))
      .catch((err) => !cancelled && setState(toState(err, false)))
    return () => {
      cancelled = true
    }
  }, [nonce])

  return (
    <div className="cobrador flex min-h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
        <header className="mb-6 text-center">
          <p className="text-xs font-semibold tracking-[0.3em] text-brand-light/60">SPARTAN TECH</p>
          <h1 className="mt-1 text-2xl font-bold">POS — Punto de Venta</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sprint 0 · verificación de arranque</p>
        </header>

        <div className="space-y-3 rounded-lg bg-secondary/50 p-4 text-sm">
          <Row label="Renderer → Fastify (HTTP)">
            {state.status === 'loading' && <Badge tone="warning">comprobando…</Badge>}
            {state.status === 'ok' && <Badge tone="success">conectado</Badge>}
            {state.status === 'error' && <Badge tone="danger">sin conexión</Badge>}
          </Row>

          {state.status === 'ok' && (
            <>
              <Row label="Fastify → SQLite">
                <Badge tone={state.data.db === 'connected' ? 'success' : 'danger'}>
                  {state.data.db === 'connected' ? 'conectado' : 'error'}
                </Badge>
              </Row>
              <Row label="Servicio">
                <span className="font-mono text-xs">{state.data.service}</span>
              </Row>
              <Row label="Versión / Fase">
                <span className="font-mono text-xs">
                  v{state.data.version} · Fase {state.data.phase}
                </span>
              </Row>
            </>
          )}

          {state.status === 'error' && (
            <p className="text-xs text-pos-danger">
              {state.message}. ¿Está el Main Process levantando el servidor en :3001?
            </p>
          )}
        </div>

        <button
          onClick={() => recheck()}
          className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Volver a comprobar
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Badge({
  tone,
  children
}: {
  tone: 'success' | 'danger' | 'warning'
  children: React.ReactNode
}): React.JSX.Element {
  const toneClass = {
    success: 'bg-pos-success/15 text-pos-success',
    danger: 'bg-pos-danger/15 text-pos-danger',
    warning: 'bg-pos-warning/15 text-pos-warning'
  }[tone]
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  )
}

export default App
