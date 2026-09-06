import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setTokenProvider, setUnauthorizedHandler } from './api/client'
import { getToken, useAuthStore } from './stores/auth.store'
// Conecta Socket.io y engancha los listeners de eventos de negocio al arrancar.
import './stores/socket.store'

// El cliente HTTP toma el JWT del store de sesión (en memoria) en cada request.
setTokenProvider(getToken)
// Si el servidor rechaza el token, se cierra la sesión y ProtectedRoute manda a /login.
setUnauthorizedHandler(() => useAuthStore.getState().clear())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
