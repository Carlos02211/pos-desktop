import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Printer, RefreshCw, XCircle } from 'lucide-react'
import type { SystemPrintersResponse } from '@shared/types'
import { ApiRequestError } from '@/api/client'
import { imprimirPrueba, listImpresoras } from '@/api/admin'
import { cn } from '@/lib/utils'

/**
 * Configuración de la impresora de tickets. Guarda `config.printer_interface` en el formato
 * que entiende el servidor (ver `src/main/services/printer.ts`):
 *   ''                    sin impresora
 *   tcp://<ip>:<puerto>   impresora de red
 *   windows:<nombre>      impresora instalada en Windows en la PC servidor (USB)
 *   otro texto            avanzado (ruta de dispositivo)
 */

type Mode = 'none' | 'network' | 'windows' | 'custom'

const DEFAULT_PORT = '9100'

function parse(value: string): { mode: Mode; host: string; port: string; name: string } {
  const v = value.trim()
  const empty = { host: '', port: DEFAULT_PORT, name: '' }
  if (!v) return { mode: 'none', ...empty }
  const net = /^tcp:\/\/([^/:]+)(?::(\d+))?\/?$/i.exec(v)
  if (net) return { mode: 'network', host: net[1], port: net[2] ?? DEFAULT_PORT, name: '' }
  if (v.startsWith('windows:')) return { mode: 'windows', ...empty, name: v.slice(8) }
  return { mode: 'custom', ...empty }
}

const MODES: { value: Mode; label: string; help: string }[] = [
  { value: 'none', label: 'Sin impresora', help: 'Las ventas se registran sin imprimir ticket.' },
  {
    value: 'windows',
    label: 'Conectada a la PC servidor (USB)',
    help: 'La impresora está enchufada por USB a la PC servidor y tiene su driver instalado en Windows.'
  },
  {
    value: 'network',
    label: 'Impresora de red (cable o WiFi)',
    help: 'La impresora tiene su propia IP en la red del negocio.'
  },
  { value: 'custom', label: 'Avanzado', help: 'Escribir la conexión a mano (soporte técnico).' }
]

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'

export function ImpresoraSection({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const parsed = parse(value)
  const [mode, setMode] = useState<Mode>(parsed.mode)
  const [printers, setPrinters] = useState<SystemPrintersResponse | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)

  const loadPrinters = useCallback(async (): Promise<void> => {
    setLoadingList(true)
    try {
      setPrinters(await listImpresoras())
    } catch {
      setPrinters({ supported: true, printers: [], error: 'No se pudo leer la lista.' })
    } finally {
      setLoadingList(false)
    }
  }, [])

  // Si ya estaba configurada una impresora de Windows, traer la lista al abrir.
  useEffect(() => {
    if (parse(value).mode !== 'windows') return
    listImpresoras()
      .then(setPrinters)
      .catch(() =>
        setPrinters({ supported: true, printers: [], error: 'No se pudo leer la lista.' })
      )
    // sólo al montar: después la lista se pide al elegir el modo o con "actualizar"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectMode(m: Mode): void {
    setMode(m)
    setTest(null)
    if (m === 'windows' && !printers) void loadPrinters()
    if (m === 'none') onChange('')
    if (m === 'network') onChange(parsed.host ? `tcp://${parsed.host}:${parsed.port}` : '')
    if (m === 'windows') onChange(parsed.name ? `windows:${parsed.name}` : '')
    // 'custom' conserva el texto actual para editarlo
  }

  function setNetwork(host: string, port: string): void {
    setTest(null)
    onChange(host.trim() ? `tcp://${host.trim()}:${port.trim() || DEFAULT_PORT}` : '')
  }

  async function runTest(): Promise<void> {
    setTesting(true)
    setTest(null)
    try {
      const r = await imprimirPrueba(value)
      setTest(
        r.printed
          ? { ok: true, msg: 'Salió la hoja de prueba. Si no la ves, revisá papel y tapa.' }
          : { ok: false, msg: r.error ?? 'No se pudo imprimir.' }
      )
    } catch (err) {
      setTest({
        ok: false,
        msg: err instanceof ApiRequestError ? err.message : 'No se pudo imprimir.'
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Printer className="h-4 w-4" /> Impresora de tickets
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Los tickets salen por esta impresora sin importar desde qué caja o tableta se cobre.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => selectMode(m.value)}
            aria-pressed={mode === m.value}
            className={cn(
              'rounded-lg border px-3 py-2 text-left text-sm transition',
              mode === m.value
                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                : 'border-border hover:bg-secondary'
            )}
          >
            <span className="block font-medium">{m.label}</span>
            <span className="block text-xs text-muted-foreground">{m.help}</span>
          </button>
        ))}
      </div>

      {mode === 'windows' && (
        <div className="mt-4">
          <span className="mb-1 block text-sm font-medium">Impresora instalada en el servidor</span>
          <div className="flex gap-2">
            <select
              value={parsed.name}
              onChange={(e) => {
                setTest(null)
                onChange(e.target.value ? `windows:${e.target.value}` : '')
              }}
              className={inputClass}
              disabled={loadingList || !printers?.supported}
            >
              <option value="">— Elegí una impresora —</option>
              {parsed.name && !printers?.printers.some((p) => p.name === parsed.name) && (
                <option value={parsed.name}>{parsed.name} (no encontrada)</option>
              )}
              {printers?.printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.port ? ` · ${p.port}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadPrinters()}
              disabled={loadingList}
              title="Actualizar lista"
              className="shrink-0 rounded-lg border border-border px-3 hover:bg-secondary disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', loadingList && 'animate-spin')} />
            </button>
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">
            {printers && !printers.supported
              ? 'El servidor no corre en Windows: usá "Impresora de red" o "Avanzado".'
              : (printers?.error ??
                'Si no aparece: instalá el driver de la impresora en la PC servidor (el del fabricante, p. ej. Xprinter) y tocá actualizar.')}
          </span>
        </div>
      )}

      {mode === 'network' && (
        <div className="mt-4 grid grid-cols-[1fr_6rem] gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">IP de la impresora</span>
            <input
              value={parsed.host}
              onChange={(e) => setNetwork(e.target.value, parsed.port)}
              placeholder="La que imprime la hoja de autoprueba"
              inputMode="decimal"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Puerto</span>
            <input
              value={parsed.port}
              onChange={(e) => setNetwork(parsed.host, e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </label>
          <span className="col-span-2 text-xs text-muted-foreground">
            Para ver su IP: con la impresora apagada, mantené presionado el botón FEED y encendela;
            imprime una hoja de autoprueba con la IP. Conviene fijarle esa IP en el router. El
            puerto casi siempre es 9100.
          </span>
        </div>
      )}

      {mode === 'custom' && (
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium">Conexión</span>
          <input
            value={value}
            onChange={(e) => {
              setTest(null)
              onChange(e.target.value)
            }}
            placeholder="tcp://<ip>:9100 · windows:<nombre> · ruta del dispositivo"
            className={inputClass}
          />
        </label>
      )}

      {mode !== 'none' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || !value.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            {testing ? 'Imprimiendo…' : 'Imprimir hoja de prueba'}
          </button>
          {test && (
            <span
              className={cn(
                'flex items-start gap-1.5 text-sm',
                test.ok ? 'text-pos-success' : 'text-destructive'
              )}
            >
              {test.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="break-words">{test.msg}</span>
            </span>
          )}
        </div>
      )}
    </section>
  )
}
