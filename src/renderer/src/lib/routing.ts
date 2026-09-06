import type { Role } from '@shared/types'

/** Ruta de inicio de cada rol tras iniciar sesión. */
export function homeFor(role: Role): string {
  return role === 'ADMIN' ? '/admin' : '/cobrador'
}
