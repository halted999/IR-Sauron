import apiClient from './client'
import type {
  Alert, Case, CreateAlertData, EscalateAlertData, BulkEscalateAlertData, AlertStatus, CaseSeverity,
} from '../types'

export interface AlertsParams {
  status?: AlertStatus
  severity?: CaseSeverity
  case_id?: string
  deleted?: boolean
  skip?: number
  limit?: number
}

export async function getAlerts(params?: AlertsParams): Promise<Alert[]> {
  const response = await apiClient.get<Alert[]>('/alerts', { params })
  return response.data
}

export interface PagedResult<T> {
  items: T[]
  total: number
}

export async function getAlertsPaged(params?: AlertsParams): Promise<PagedResult<Alert>> {
  const response = await apiClient.get<Alert[]>('/alerts', { params })
  const total = Number(response.headers['x-total-count'] ?? response.data.length)
  return { items: response.data, total }
}

export async function getAlert(id: string): Promise<Alert> {
  const response = await apiClient.get<Alert>(`/alerts/${id}`)
  return response.data
}

export async function createAlert(data: CreateAlertData): Promise<Alert> {
  const response = await apiClient.post<Alert>('/alerts', data)
  return response.data
}

export async function updateAlert(
  id: string,
  data: Partial<CreateAlertData> & { status?: AlertStatus },
): Promise<Alert> {
  const response = await apiClient.put<Alert>(`/alerts/${id}`, data)
  return response.data
}

export async function escalateAlert(id: string, data: EscalateAlertData): Promise<Case> {
  const response = await apiClient.post<Case>(`/alerts/${id}/escalate`, data)
  return response.data
}

export async function escalateAlertsBulk(data: BulkEscalateAlertData): Promise<Case> {
  const response = await apiClient.post<Case>('/alerts/escalate-bulk', data)
  return response.data
}

export async function detachAlert(id: string): Promise<Alert> {
  const response = await apiClient.post<Alert>(`/alerts/${id}/detach`)
  return response.data
}

export async function deleteAlertsBulk(alertIds: string[]): Promise<Alert[]> {
  const response = await apiClient.post<Alert[]>('/alerts/delete-bulk', { alert_ids: alertIds })
  return response.data
}

export async function restoreAlertsBulk(alertIds: string[]): Promise<Alert[]> {
  const response = await apiClient.post<Alert[]>('/alerts/restore-bulk', { alert_ids: alertIds })
  return response.data
}

export async function purgeAlertsBulk(alertIds: string[]): Promise<void> {
  await apiClient.post('/alerts/purge-bulk', { alert_ids: alertIds })
}

export async function assignAlertsBulk(alertIds: string[], userId: string | null): Promise<Alert[]> {
  const response = await apiClient.post<Alert[]>('/alerts/assign-bulk', {
    alert_ids: alertIds,
    user_id: userId,
  })
  return response.data
}
