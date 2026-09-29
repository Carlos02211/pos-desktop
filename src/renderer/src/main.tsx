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
// Captura el aviso de "se puede instalar como app" antes de que se muestre el login.
import './stores/install.store'

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

// Instalar como app (PWA): sólo cuando la SPA la sirve el servidor por http(s). En la app
// de escritorio (file://) no aplica y el enlace daría un error en la consola.
if (window.location.protocol.startsWith('http')) {
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = '/manifest.webmanifest'
  document.head.appendChild(link)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
