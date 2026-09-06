import { SessionBar } from '@/components/SessionBar'

export default function PanelVenta(): React.JSX.Element {
  return (
    <div className="cobrador flex min-h-full flex-col bg-background text-foreground">
      <SessionBar />
      <main className="flex flex-1 items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-2xl font-bold">Panel del Cobrador</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Grid de productos y carrito — Sprint 2.
          </p>
        </div>
      </main>
    </div>
  )
}
