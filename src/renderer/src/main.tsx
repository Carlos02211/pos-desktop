import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { me } from './api/auth'
import { setTokenProvider, setUnauthorizedHandler } from './api/client'
import { getToken, useAuthStore } from './stores/auth.store'
// Conecta Socket.io y engancha los listeners de eventos de negocio al arrancar.
import './stores/socket.store'

// El cliente HTTP toma el JWT del store de sesión en cada request.
setTokenProvider(getToken)
// Si el servidor rechaza el token, se cierra la sesión y ProtectedRoute manda a /login.
setUnauthorizedHandler(() => useAuthStore.getState().clear())

// Sesión restaurada tras una recarga: revalidarla y refrescar los datos del usuario (rol,
// nombre). Un token vencido responde 401 y el handler de arriba cierra la sesión.
const restoredToken = getToken()
if (restoredToken) {
  me()
    .then(({ user }) => {
      if (getToken() === restoredToken) useAuthStore.getState().setAuth(restoredToken, user)
    })
    .catch(() => {
      // 401 ya lo maneja el handler; un error de red deja la sesión (se reintenta al usarla).
    })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
