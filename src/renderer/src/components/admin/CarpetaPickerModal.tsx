import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Folder, FolderPlus, HardDrive, Loader2, Undo2 } from 'lucide-react'
import type { FolderListing } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { crearCarpeta, listCarpetas } from '@/api/admin'
import { Modal } from '@/components/Modal'

/**
 * Navegador de carpetas de la PC SERVIDOR (no de la tableta/PC desde la que se usa el
 * panel): los respaldos se escriben en el servidor.
 */
export function CarpetaPickerModal({
  initialPath,
  onPick,
  onClose
}: {
  initialPath?: string
  onPick: (path: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState<string | null>(null)

  const open = useCallback(async (path?: string): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setListing(await listCarpetas(path))
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo abrir la carpeta')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // La carpeta actual puede no existir todavía: en ese caso, arrancar por las unidades.
    listCarpetas(initialPath)
      .catch(() => listCarpetas())
      .then(setListing)
      .catch(() => setError('No se pudo leer las carpetas del servidor'))
  }, [initialPath])

  async function createHere(): Promise<void> {
    if (!listing?.path || !newName?.trim()) return
    try {
      const { path } = await crearCarpeta(listing.path, newName.trim())
      setNewName(null)
      await open(path)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo crear la carpeta')
    }
  }

  const atRoots = listing !== null && listing.path === null

  return (
    <Modal title="Elegir carpeta de respaldos" onClose={onClose}>
      <p className="mb-3 text-xs text-muted-foreground">
        Carpetas de la <strong>PC servidor</strong>. Lo ideal es otro disco o una USB, para que un
        respaldo sobreviva si falla el disco principal.
      </p>

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void open(listing?.parent ?? undefined)}
          disabled={!listing || listing.parent === null || loading}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" /> Subir
        </button>
        <code
          title={listing?.path ?? undefined}
          dir="rtl"
          className="min-w-0 flex-1 truncate rounded-md bg-secondary/60 px-2 py-1 text-left text-xs"
        >
          <bdi>{atRoots ? 'Unidades' : (listing?.path ?? '…')}</bdi>
        </code>
      </div>

      <div className="h-64 overflow-y-auto rounded-lg border border-border">
        {(loading || (!listing && !error)) && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!loading && listing?.dirs.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">Esta carpeta no tiene subcarpetas.</p>
        )}
        {!loading && (
          <ul>
            {listing?.dirs.map((d) => (
              <li key={d.path}>
                <button
                  type="button"
                  onClick={() => void open(d.path)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  {atRoots ? (
                    <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {newName !== null ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void createHere()
          }}
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre de la carpeta nueva"
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-lg bg-secondary px-3 text-sm">
            Crear
          </button>
          <button
            type="button"
            onClick={() => setNewName(null)}
            className="px-2 text-sm text-muted-foreground"
          >
            Cancelar
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNewName('Respaldos POS')}
          disabled={!listing?.path}
          className="mt-3 inline-flex items-center gap-1 text-sm text-primary disabled:opacity-40"
        >
          <FolderPlus className="h-4 w-4" /> Nueva carpeta aquí
        </button>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => listing?.path && onPick(listing.path)}
          disabled={!listing?.path}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Usar esta carpeta
        </button>
      </div>
    </Modal>
  )
}
