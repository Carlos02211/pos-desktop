import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '@/api/client'
import { login as loginRequest } from '@/api/auth'
import { AuthShell, ErrorText, SubmitButton, TextField } from '@/components/AuthShell'
import { useAuthStore } from '@/stores/auth.store'
import { useLicenseStore } from '@/stores/license.store'
import { homeFor } from '@/lib/routing'

export default function Login(): React.JSX.Element {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const user = useAuthStore((s) => s.user)
  const licenseActive = useLicenseStore((s) => s.status?.active ?? false)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!licenseActive) return <Navigate to="/activation" replace />
  if (user) return <Navigate to={homeFor(user.role)} replace />

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await loginRequest(username.trim(), password)
      setAuth(res.token, res.user)
      navigate(homeFor(res.user.role), { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 401
          ? 'Usuario o contraseña incorrectos'
          : err instanceof ApiRequestError
            ? err.message
            : 'No se pudo conectar con el servidor'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Iniciar sesión" subtitle="Punto de venta" footer="SpArTaN Tech · POS Fase 1">
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="Usuario"
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <SubmitButton loading={submitting} disabled={!username.trim() || !password}>
          Entrar
        </SubmitButton>
      </form>
    </AuthShell>
  )
}
