import apiClient from './client'
import type { UserRole } from '../types'

export interface AppSettings {
  timezone: string
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_username?: string | null
  smtp_password?: string | null
  smtp_from_email?: string | null
  smtp_use_tls: boolean
  email_notifications_enabled: boolean
  telegram_bot_token?: string | null
  telegram_chat_id?: string | null
  telegram_notifications_enabled: boolean
  updated_at: string
}

export type UpdateAppSettingsData = Partial<Omit<AppSettings, 'updated_at'>>

export async function getAppSettings(): Promise<AppSettings> {
  const response = await apiClient.get<AppSettings>('/admin/settings')
  return response.data
}

export async function updateAppSettings(data: UpdateAppSettingsData): Promise<AppSettings> {
  const response = await apiClient.put<AppSettings>('/admin/settings', data)
  return response.data
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function filenameFromDisposition(disposition: string | undefined, fallback: string): string {
  const match = disposition?.match(/filename="?([^"]+)"?/)
  return match ? match[1] : fallback
}

export async function backupConfig(password: string): Promise<void> {
  const response = await apiClient.post('/admin/backup/config', { password }, { responseType: 'blob' })
  const filename = filenameFromDisposition(
    response.headers['content-disposition'],
    'irsauron-config-backup.enc',
  )
  downloadBlob(response.data as Blob, filename)
}

export async function backupDatabase(password: string): Promise<void> {
  const response = await apiClient.post('/admin/backup/database', { password }, { responseType: 'blob' })
  const filename = filenameFromDisposition(
    response.headers['content-disposition'],
    'irsauron-db-backup.dump.enc',
  )
  downloadBlob(response.data as Blob, filename)
}

export const RESTORE_CONFIRM_PHRASE = 'ВОССТАНОВИТЬ'

export async function restoreConfig(file: File, password: string, confirm: string): Promise<AppSettings> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('password', password)
  formData.append('confirm', confirm)
  const response = await apiClient.post<AppSettings>('/admin/restore/config', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function restoreDatabase(file: File, password: string, confirm: string): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('password', password)
  formData.append('confirm', confirm)
  await apiClient.post('/admin/restore/database', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export interface RolePermissionItem {
  role: UserRole
  permission: string
  allowed: boolean
}

export interface RolePermissionsResponse {
  permissions: RolePermissionItem[]
  labels: Record<string, string>
}

export async function getRolePermissions(): Promise<RolePermissionsResponse> {
  const response = await apiClient.get<RolePermissionsResponse>('/admin/role-permissions')
  return response.data
}

export async function updateRolePermissions(
  permissions: RolePermissionItem[],
): Promise<RolePermissionsResponse> {
  const response = await apiClient.put<RolePermissionsResponse>('/admin/role-permissions', { permissions })
  return response.data
}

export interface AuditLogEntry {
  id: string
  case_id?: string | null
  case_title?: string | null
  user_id?: string | null
  username?: string | null
  action: string
  object_type: string
  object_id?: string | null
  details?: Record<string, unknown> | null
  ip_address?: string | null
  ts: string
}

export interface AuditLogParams {
  skip?: number
  limit?: number
  object_type?: string
  action?: string
  user_id?: string
}

export async function getAuditLog(params?: AuditLogParams): Promise<AuditLogEntry[]> {
  const response = await apiClient.get<AuditLogEntry[]>('/admin/audit-log', { params })
  return response.data
}
