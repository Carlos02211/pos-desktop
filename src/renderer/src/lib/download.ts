import { API_BASE_URL } from '@/api/client'
import { getToken } from '@/stores/auth.store'

/**
 * Descarga un archivo autenticado del servidor local.
 * En Electron, `a.click()` sobre el enlace dispara el diálogo "Guardar como"
 * (ver el handler `will-download` en el Main Process).
 */
export async function downloadFile(
  path: string,
  query: Record<string, string | number | undefined>
): Promise<void> {
  const url = new URL(path, API_BASE_URL)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } })
  if (!res.ok) throw new Error('No se pudo generar el archivo')

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const name = /filename="(.+?)"/.exec(disposition)?.[1] ?? 'descarga'

  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}
