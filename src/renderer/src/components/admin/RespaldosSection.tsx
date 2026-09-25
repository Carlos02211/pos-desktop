import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2 } from 'lucide-react'
import type { BackupStatus } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { getRespaldos, probarCarpeta, respaldarAhora, updateConfig } from '@/api/admin'
import { CarpetaPickerModal } from '@/components/admin/CarpetaPickerModal'

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/**
 * Respaldos de la base: dónde se guardan (elegida con el navegador de carpetas del
 * servidor), cuándo fue el último y un botón para respaldar ya. La carpeta se guarda al
 * elegirla, después de comprobar que el servidor puede escribir ahí.
 */
export function RespaldosSection(): React.JSX.Element {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [picking, setPicking] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await getRespaldos())
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'No se pudo leer el estado')
    }
  }, [])

  useEffect(() => {
    getRespaldos()
      .then(setStatus)
      .catch(() => setError('No se pudo leer el estado de los respaldos'))
  }, [])

  async function choose(path: string | ''): Promise<void> {
    setPicking(false)
    setError('')
    if (path) {
      const probe = await probarCarpeta(path)
      if (!probe.ok) {
        setError(probe.error ?? 'No se puede escribir en esa carpeta.')
        return
      }
    }
    await updateConfig({ backup_dir: path })
    toast.success(path ? 'Carpeta de respaldos guardada' : 'Se usa la carpeta por defecto')
    await refresh()
  }

  async function runNow(): Promise<void> {
    setRunning(true)
    setError('')
    try {
      const r = await respaldarAhora()
      if (r.ok && r.file) toast.success(`Respaldo creado (${fmtSize(r.file.sizeBytes)})`)
      else if (r.ok) toast.info(r.skipped ?? 'Respaldo omitido')
      else setError(r.error ?? 'El respaldo falló')
      await refresh()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'El respaldo falló')
    } finally {
      setRunning(false)
    }
  }

  const last = status?.backups[0]
  const failed = status?.lastAttempt && !status.lastAttempt.ok ? status.lastAttempt : null

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="font-semibold">Respaldos</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Se respalda solo al cerrar cada caja y una vez al día. Se guardan los últimos 30.
      </p>

      <div className="mt-3">
        <span className="mb-1 block text-sm font-medium">Carpeta</span>
        <div className="flex items-center gap-2">
          <code
            title={status?.dir}
            dir="rtl"
            className="min-w-0 flex-1 truncate rounded-lg bg-secondary/60 px-3 py-2 text-left text-xs"
          >
            {/* rtl: si no entra, se recorta el principio y queda visible la carpeta final */}
            <bdi>{status?.dir ?? '…'}</bdi>
          </code>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"
          >
            <FolderOpen className="h-4 w-4" /> Cambiar…
          </button>
        </div>
        <span className="mt-1 block text-xs text-muted-foreground">
          {status?.isDefaultDir ? (
            'Carpeta por defecto (en el mismo disco del servidor). Recomendado: otro disco o una USB.'
          ) : (
            <>
              En la PC servidor.{' '}
              <button type="button" onClick={() => void choose('')} className="underline">
                Volver a la carpeta por defecto
              </button>
            </>
          )}
        </span>
      </div>

      {status?.unsupported ? (
        <p className="mt-3 text-sm text-muted-foreground">{status.unsupported}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={running || !status}
            className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {running ? 'Respaldando…' : 'Respaldar ahora'}
          </button>
          <span className="flex items-center gap-1.5 text-sm">
            {last ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-pos-success" />
                Último: {fmtDate(last.createdAt)} · {fmtSize(last.sizeBytes)}
              </>
            ) : (
              <span className="text-muted-foreground">Todavía no hay respaldos.</span>
            )}
          </span>
        </div>
      )}

      {(error || failed) && (
        <p className="mt-3 flex gap-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">
            {error || `El último respaldo (${fmtDate(failed!.at)}) falló: ${failed!.error}`}
          </span>
        </p>
      )}

      {picking && (
        <CarpetaPickerModal
          initialPath={status?.dir}
          onPick={(p) => void choose(p)}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  )
}
