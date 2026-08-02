import apiClient from './client'
import type { Case, CreateCaseData } from '../types'

export interface CasesParams {
  status?: string
  severity?: string
  q?: string
  archived?: boolean
  skip?: number
  limit?: number
}

export async function getCases(params?: CasesParams): Promise<Case[]> {
  const response = await apiClient.get<Case[]>('/cases', { params })
  return response.data
}

export interface PagedResult<T> {
  items: T[]
  total: number
}

export async function getCasesPaged(params?: CasesParams): Promise<PagedResult<Case>> {
  const response = await apiClient.get<Case[]>('/cases', { params })
  const total = Number(response.headers['x-total-count'] ?? response.data.length)
  return { items: response.data, total }
}

export async function getCase(id: string): Promise<Case> {
  const response = await apiClient.get<Case>(`/cases/${id}`)
  return response.data
}

export async function createCase(data: CreateCaseData): Promise<Case> {
  const response = await apiClient.post<Case>('/cases', data)
  return response.data
}

export interface UpdateCaseData extends Partial<CreateCaseData> {
  status?: string
  root_cause?: string
  impact_summary?: string
  attribution?: string
  report_notes?: string
  incident_started_at?: string | null
  incident_contained_at?: string | null
  incident_closed_at?: string | null
  incident_number?: string
  detection_source?: string
  trigger_rule?: string
  severity_justification?: string
  executive_summary?: string
  attack_vector?: string
  exploited_vulnerability?: string
  tooling_used?: string
  affected_assets?: string
  confidentiality_impact?: string
  integrity_impact?: string
  availability_impact?: string
  financial_reputational_damage?: string
  sla_breach?: string
  containment_actions?: string
  eradication_actions?: string
  recovery_actions?: string
  lessons_worked_well?: string
  lessons_to_improve?: string
  new_detection_rules_needed?: string
  recommendations?: string
  approval_notes?: string
}

export async function updateCase(id: string, data: UpdateCaseData): Promise<Case> {
  const response = await apiClient.put<Case>(`/cases/${id}`, data)
  return response.data
}

export async function exportCase(id: string): Promise<Blob> {
  const response = await apiClient.get(`/cases/${id}/export`, {
    responseType: 'blob',
  })
  return response.data as Blob
}

export async function archiveCase(id: string): Promise<Case> {
  const response = await apiClient.post<Case>(`/cases/${id}/archive`)
  return response.data
}

export async function unarchiveCase(id: string): Promise<Case> {
  const response = await apiClient.post<Case>(`/cases/${id}/unarchive`)
  return response.data
}

export async function deleteCase(id: string, reason: string): Promise<void> {
  await apiClient.delete(`/cases/${id}`, { data: { reason } })
}

