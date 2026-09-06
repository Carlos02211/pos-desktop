import type { PingResponse } from '@shared/types'
import { api } from './client'

export function ping(echo?: string): Promise<PingResponse & { echo?: string }> {
  return api.get('/api/ping', { query: { echo } })
}
