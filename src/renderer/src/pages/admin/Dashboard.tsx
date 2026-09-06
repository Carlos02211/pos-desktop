import { SessionBar } from '@/components/SessionBar'

export default function Dashboard(): React.JSX.Element {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <SessionBar />
      <main className="flex flex-1 items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-2xl font-bold">Panel del Administrador</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Dashboard, productos, usuarios y reportes — Sprint 4 en adelante.
          </p>
        </div>
      </main>
    </div>
  )
}
