import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { ApiRequestError } from '@/api/client'
import { activateLicense } from '@/api/license'
import { AuthShell, ErrorText, SubmitButton, TextField } from '@/components/AuthShell'
import { useLicenseStore } from '@/stores/license.store'

export default function Activation(): React.JSX.Element {
  const navigate = useNavigate()
  const { phase, status, refresh, set } = useLicenseStore()
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (phase === 'loading') void refresh()
  }, [phase, refresh])

  useEffect(() => {
    if (status?.active) navigate('/login', { replace: true })
  }, [status?.active, navigate])

  async function copyId(): Promise<void> {
    if (!status?.fingerprint) return
    if (await copyText(status.fingerprint)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await activateLicense(key.trim())
      set(result)
      navigate('/login', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'No se pudo activar. Revisa la clave.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Activar licencia"
      subtitle="Este equipo aún no tiene una licencia válida"
      footer="SpArTaN Tech · Punto de venta"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">ID del equipo</span>
            {status?.fingerprint && (
              <button
                type="button"
                onClick={() => void copyId()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-secondary"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copiado' : 'Copiar ID'}
              </button>
            )}
          </div>
          <code className="block max-w-full overflow-x-auto rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed break-all">
            {phase === 'unreachable'
              ? 'servidor no disponible'
              : (status?.fingerprint ?? 'calculando…')}
          </code>
          <span className="mt-1 block text-xs text-muted-foreground">
            Envía este ID a SpArTaN Tech para obtener tu clave. Es el de la PC donde está instalado
            el sistema, aunque lo abras desde otro dispositivo.
          </span>
        </div>

        <TextField
          label="Clave de activación"
          placeholder="Pega aquí la clave completa (XXXXX-XXXXX-…)"
          autoFocus
          spellCheck={false}
          autoCapitalize="characters"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />

        <ErrorText>{error}</ErrorText>

        <SubmitButton loading={submitting} disabled={key.trim().length < 10}>
          Activar
        </SubmitButton>
      </form>
    </AuthShell>
  )
}

/** Copia al portapapeles; sin contexto seguro (http://IP) usa el método antiguo. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
