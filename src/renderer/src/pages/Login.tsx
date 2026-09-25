import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '@/api/client'
import { login as loginRequest } from '@/api/auth'
import { AuthShell, ErrorText, SubmitButton, TextField } from '@/components/AuthShell'
import { useAuthStore } from '@/stores/auth.store'
import { useLicenseStore } from '@/stores/license.store'
import { homeFor } from '@/lib/routing'

/**
 * Último usuario que entró en ESTE dispositivo (sólo el nombre, nunca la contraseña), para
 * no tener que escribirlo en cada turno. localStorage es por navegador/tableta; si no está
 * disponible (modo privado, bloqueado), simplemente no se recuerda.
 */
const LAST_USER_KEY = 'pos-last-username'

function readLastUser(): string {
  try {
    return localStorage.getItem(LAST_USER_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveLastUser(username: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, username)
  } catch {
    // sin storage: no pasa nada
  }
}

export default function Login(): React.JSX.Element {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const user = useAuthStore((s) => s.user)
  const licenseActive = useLicenseStore((s) => s.status?.active ?? false)

  const [username, setUsername] = useState(readLastUser)
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
      saveLastUser(res.user.username)
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
    <AuthShell
      title="Iniciar sesión"
      subtitle="Punto de venta"
      footer="SpArTaN Tech · Punto de venta"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="Usuario"
          autoFocus={!username}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label="Contraseña"
          type="password"
          // Con el usuario ya recordado, el cursor va directo a la contraseña.
          autoFocus={!!username}
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
