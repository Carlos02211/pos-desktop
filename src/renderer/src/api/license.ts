import type { LicenseStatusResponse } from '@shared/types'
import { api } from './client'

export function getLicenseStatus(): Promise<LicenseStatusResponse> {
  return api.get<LicenseStatusResponse>('/api/licencia/estado')
}

export function activateLicense(key: string): Promise<LicenseStatusResponse> {
  return api.post<LicenseStatusResponse>('/api/licencia/activar', { key })
}
