import apiClient from './client'
import type { CaseSeverity } from '../types'

export type AlertRuleAction = 'suppress' | 'escalate'

export interface AlertRule {
  id: string
  name: string
  match_source?: string | null
  match_severity?: CaseSeverity | null
  match_title_contains?: string | null
  match_description_contains?: string | null
  action: AlertRuleAction
  target_case_id?: string | null
  is_enabled: boolean
  applied_count: number
  last_applied_at?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface CreateAlertRuleData {
  name: string
  match_source?: string
  match_severity?: CaseSeverity
  match_title_contains?: string
  match_description_contains?: string
  action: AlertRuleAction
  target_case_id?: string
  is_enabled?: boolean
}

export type UpdateAlertRuleData = Partial<CreateAlertRuleData>

export interface AlertRuleFromSelectionData {
  alert_ids: string[]
  name: string
  match_source?: string
  match_severity?: CaseSeverity
  match_title_contains?: string
  match_description_contains?: string
  action: AlertRuleAction
  target_case_id?: string
}

export interface AlertRuleFromSelectionResult {
  rule: AlertRule
  applied_count: number
}

export interface AlertRuleMatchCriteria {
  match_source?: string
  match_severity?: CaseSeverity
  match_title_contains?: string
  match_description_contains?: string
}

export async function getAlertRules(): Promise<AlertRule[]> {
  const response = await apiClient.get<AlertRule[]>('/alert-rules')
  return response.data
}

export async function createAlertRule(data: CreateAlertRuleData): Promise<AlertRule> {
  const response = await apiClient.post<AlertRule>('/alert-rules', data)
  return response.data
}

export async function updateAlertRule(id: string, data: UpdateAlertRuleData): Promise<AlertRule> {
  const response = await apiClient.put<AlertRule>(`/alert-rules/${id}`, data)
  return response.data
}

export async function deleteAlertRule(id: string): Promise<void> {
  await apiClient.delete(`/alert-rules/${id}`)
}

export async function createAlertRuleFromSelection(
  data: AlertRuleFromSelectionData,
): Promise<AlertRuleFromSelectionResult> {
  const response = await apiClient.post<AlertRuleFromSelectionResult>('/alert-rules/from-selection', data)
  return response.data
}

export async function previewAlertRuleMatches(criteria: AlertRuleMatchCriteria): Promise<number> {
  const response = await apiClient.post<{ matching_count: number }>('/alert-rules/preview-matches', criteria)
  return response.data.matching_count
}
