import apiClient from './client'

export interface MitreTechnique {
  id: string
  name: string
  tactics: string[]
  is_subtechnique: boolean
  parent_technique_id?: string | null
}

export interface MitreTacticInfo {
  shortname: string
  label: string
  severity: string
  grif: string
}

export interface MitreMatrix {
  tactics: MitreTacticInfo[]
  techniques: MitreTechnique[]
  technique_count: number
  last_synced_at?: string | null
}

export interface MitreSettings {
  sync_interval_hours: number
  last_synced_at?: string | null
  last_sync_status?: string | null
  last_sync_message?: string | null
  technique_count?: number | null
  source_url: string
}

export interface MitreSyncResult {
  ok: boolean
  message: string
  technique_count: number
}

export async function getMitreMatrix(): Promise<MitreMatrix> {
  const response = await apiClient.get<MitreMatrix>('/mitre/matrix')
  return response.data
}

export async function getMitreSettings(): Promise<MitreSettings> {
  const response = await apiClient.get<MitreSettings>('/mitre/settings')
  return response.data
}

export async function updateMitreSettings(syncIntervalHours: number): Promise<MitreSettings> {
  const response = await apiClient.put<MitreSettings>('/mitre/settings', {
    sync_interval_hours: syncIntervalHours,
  })
  return response.data
}

export async function syncMitreNow(): Promise<MitreSyncResult> {
  const response = await apiClient.post<MitreSyncResult>('/mitre/sync-now')
  return response.data
}
