import apiClient from './client'

export interface DemoModeStatus {
  enabled: boolean
}

export async function getDemoModeStatus(): Promise<DemoModeStatus> {
  const response = await apiClient.get<DemoModeStatus>('/admin/demo-mode/status')
  return response.data
}

export async function toggleDemoMode(enabled: boolean): Promise<DemoModeStatus> {
  const response = await apiClient.post<DemoModeStatus>('/admin/demo-mode/toggle', { enabled })
  return response.data
}

export interface SeedDataResult {
  cases_created: number
  alerts_created: number
}

export async function seedDemoData(): Promise<SeedDataResult> {
  const response = await apiClient.post<SeedDataResult>('/admin/demo-mode/seed-data')
  return response.data
}

export interface SeedCountResult {
  created: number
}

export async function seedDemoEventSources(): Promise<SeedCountResult> {
  const response = await apiClient.post<SeedCountResult>('/admin/demo-mode/seed-event-sources')
  return response.data
}

export async function seedDemoAuditLog(): Promise<SeedCountResult> {
  const response = await apiClient.post<SeedCountResult>('/admin/demo-mode/seed-audit-log')
  return response.data
}

export const CLEAR_CONFIRM_PHRASE = 'УДАЛИТЬ ВСЁ'

export interface ClearDataResult {
  alerts_deleted: number
  cases_deleted: number
}

export async function clearDemoData(confirm: string): Promise<ClearDataResult> {
  const response = await apiClient.post<ClearDataResult>('/admin/demo-mode/clear-data', { confirm })
  return response.data
}
