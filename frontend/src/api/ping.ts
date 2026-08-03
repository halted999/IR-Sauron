import apiClient from './client'

export interface PingResponse {
  status: string
  maintenance: boolean
  demo_mode_enabled: boolean
  reason: string | null
  progress: { processed: number; total: number } | null
  last_error: string | null
}

export async function getPing(): Promise<PingResponse> {
  const response = await apiClient.get<PingResponse>('/ping')
  return response.data
}
