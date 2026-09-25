import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, KeyRound, TriangleAlert, User } from 'lucide-react'
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

  const [remembered] = useState(readLastUser)
  const [username, setUsername] = useState(remembered)
  // Con un usuario recordado se muestra el saludo en vez del campo (un toque menos).
  const [editingUser, setEditingUser] = useState(!remembered)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
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
      subtitle="Entrá con tu usuario para empezar el turno."
      footer="SpArTaN Tech · Punto de venta"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {editingUser ? (
          <TextField
            label="Usuario"
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            icon={<User className="h-4 w-4" />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-sky-600 text-lg font-bold uppercase text-slate-950">
              {username.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-400">Hola de nuevo,</p>
              <p className="truncate font-semibold text-white">{username}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingUser(true)
                setUsername('')
                setError('')
              }}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-cyan-300 transition hover:bg-cyan-400/10"
            >
              Cambiar
            </button>
          </div>
        )}
        <TextField
          label="Contraseña"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          // Con el usuario ya recordado, el cursor va directo a la contraseña.
          autoFocus={!editingUser}
          icon={<KeyRound className="h-4 w-4" />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
          onBlur={() => setCapsLock(false)}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
          hint={
            capsLock ? (
              <span className="flex items-center gap-1.5 text-amber-300">
                <TriangleAlert className="h-3.5 w-3.5" /> Bloq Mayús está activado
              </span>
            ) : undefined
          }
        />
        <ErrorText>{error}</ErrorText>
        <SubmitButton loading={submitting} disabled={!username.trim() || !password}>
          Entrar <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </SubmitButton>
      </form>
    </AuthShell>
  )
}
