/**
 * Mensaje de error para la pantalla, en español. Los errores del sistema (fs, red) llegan
 * en inglés ("ENOENT: no such file or directory…"): se traducen por su código. Los
 * mensajes propios (ya en español) pasan tal cual.
 */
const SYSTEM_MESSAGES: Record<string, string> = {
  ENOENT:
    'La carpeta o el archivo no existe o no está disponible (¿una unidad de red o USB desconectada?).',
  EACCES: 'No hay permiso para usar esa carpeta.',
  EPERM: 'No hay permiso para usar esa carpeta.',
  ENOSPC: 'No queda espacio en el disco.',
  EROFS: 'Ese disco es de sólo lectura.',
  EBUSY: 'El archivo está en uso por otro programa.',
  ENOTDIR: 'La ruta no es una carpeta.',
  ECONNREFUSED: 'La impresora rechazó la conexión: revisa la IP y el puerto.',
  EHOSTUNREACH:
    'No se encuentra la impresora en la red: revisa que esté encendida y en la misma red.',
  ENETUNREACH: 'No hay conexión con la red de la impresora.',
  ETIMEDOUT: 'La impresora no respondió a tiempo.',
  ECONNRESET: 'Se cortó la conexión con la impresora.'
}

export function errorMessage(err: unknown, fallback: string): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code && SYSTEM_MESSAGES[code]) return SYSTEM_MESSAGES[code]
  if (!(err instanceof Error) || !err.message) return fallback
  // Un código de sistema que no está en la lista: mejor el mensaje genérico que inglés crudo.
  if (/^E[A-Z]+[:\s]/.test(err.message)) return fallback
  return err.message
}
