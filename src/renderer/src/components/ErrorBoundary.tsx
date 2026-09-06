import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Evita la pantalla en blanco si un componente lanza: muestra un aviso con recarga. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="cobrador flex min-h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
        <div>
          <h1 className="text-lg font-bold">Ocurrió un error inesperado</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{this.state.error.message}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Recargar la aplicación
        </button>
      </div>
    )
  }
}
