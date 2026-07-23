import apiClient from './client'

export type EventSourceType = 'elastic' | 'thehive'

export interface EventSource {
  id: string
  name: string
  source_type: EventSourceType
  base_url: string
  verify_ssl: boolean
  auth_username?: string | null
  has_secret: boolean
  config?: Record<string, unknown> | null
  is_enabled: boolean
  poll_interval_seconds: number
  last_synced_at?: string | null
  last_sync_status?: string | null
  last_sync_message?: string | null
  last_sync_alert_count?: number | null
  created_at: string
  updated_at: string
}

export interface CreateEventSourceData {
  name: string
  source_type: EventSourceType
  base_url: string
  verify_ssl: boolean
  auth_username?: string
  auth_secret?: string
  config?: Record<string, unknown>
  is_enabled: boolean
  poll_interval_seconds: number
}

export type UpdateEventSourceData = Partial<CreateEventSourceData>

export interface EventSourceTestResult {
  ok: boolean
  message: string
}

export interface EventSourceSyncResult {
  ok: boolean
  message: string
  new_alerts: number
}

export async function getEventSources(): Promise<EventSource[]> {
  const response = await apiClient.get<EventSource[]>('/event-sources')
  return response.data
}

export async function createEventSource(data: CreateEventSourceData): Promise<EventSource> {
  const response = await apiClient.post<EventSource>('/event-sources', data)
  return response.data
}

export async function updateEventSource(id: string, data: UpdateEventSourceData): Promise<EventSource> {
  const response = await apiClient.put<EventSource>(`/event-sources/${id}`, data)
  return response.data
}

export async function deleteEventSource(id: string): Promise<void> {
  await apiClient.delete(`/event-sources/${id}`)
}

export async function testEventSourceConnection(id: string): Promise<EventSourceTestResult> {
  const response = await apiClient.post<EventSourceTestResult>(`/event-sources/${id}/test-connection`)
  return response.data
}

export async function syncEventSourceNow(id: string): Promise<EventSourceSyncResult> {
  const response = await apiClient.post<EventSourceSyncResult>(`/event-sources/${id}/sync-now`)
  return response.data
}
