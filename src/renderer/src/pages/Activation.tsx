import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

  useEffect(() => {
    if (phase === 'loading') void refresh()
  }, [phase, refresh])

  useEffect(() => {
    if (status?.active) navigate('/login', { replace: true })
  }, [status?.active, navigate])

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
      footer="SpArTaN Tech · POS Fase 1"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <span className="mb-1 block text-sm font-medium">ID de este equipo</span>
          <code className="block max-w-full overflow-x-auto rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed break-all">
            {phase === 'unreachable'
              ? 'servidor no disponible'
              : (status?.fingerprint ?? 'calculando…')}
          </code>
          <span className="mt-1 block text-xs text-muted-foreground">
            Envía este ID a SpArTaN Tech para obtener tu clave.
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
