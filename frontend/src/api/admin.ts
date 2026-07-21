import apiClient from './client'

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
