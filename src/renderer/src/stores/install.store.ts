import { create } from 'zustand'

/**
 * "Instalar como app" (PWA). Chrome/Edge disparan `beforeinstallprompt` cuando la app se
 * puede instalar (HTTPS + manifiesto); se guarda para mostrar el botón en el login. Este
 * módulo se importa al arrancar (main.tsx) porque el evento llega enseguida.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface InstallState {
  prompt: BeforeInstallPromptEvent | null
  install: () => Promise<void>
}

export const useInstallStore = create<InstallState>((set, get) => ({
  prompt: null,
  install: async () => {
    const p = get().prompt
    if (!p) return
    await p.prompt()
    await p.userChoice
    set({ prompt: null }) // el evento sirve una sola vez
  }
}))

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // sin la barra automática: lo ofrece nuestro botón
  useInstallStore.setState({ prompt: e as BeforeInstallPromptEvent })
})
window.addEventListener('appinstalled', () => useInstallStore.setState({ prompt: null }))
