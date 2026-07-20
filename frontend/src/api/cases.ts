import apiClient from './client'
import type { Case, AuditEntry, CreateCaseData, UserRole, VerificationStatus } from '../types'

export interface CasesParams {
  status?: string
  severity?: string
  skip?: number
  limit?: number
}

export async function getCases(params?: CasesParams): Promise<Case[]> {
  const response = await apiClient.get<Case[]>('/cases', { params })
  return response.data
}

export async function getCase(id: string): Promise<Case> {
  const response = await apiClient.get<Case>(`/cases/${id}`)
  return response.data
}

export async function createCase(data: CreateCaseData): Promise<Case> {
  const response = await apiClient.post<Case>('/cases', data)
  return response.data
}

export async function updateCase(id: string, data: Partial<CreateCaseData> & { status?: string; verification_status?: VerificationStatus; root_cause?: string; impact_summary?: string; attribution?: string }): Promise<Case> {
  const response = await apiClient.put<Case>(`/cases/${id}`, data)
  return response.data
}

export async function exportCase(id: string): Promise<Blob> {
  const response = await apiClient.get(`/cases/${id}/export`, {
    responseType: 'blob',
  })
  return response.data as Blob
}

export async function addParticipant(caseId: string, userId: string, role: UserRole): Promise<void> {
  await apiClient.post(`/cases/${caseId}/participants`, { user_id: userId, role })
}

export async function removeParticipant(caseId: string, userId: string): Promise<void> {
  await apiClient.delete(`/cases/${caseId}/participants/${userId}`)
}

export async function getAuditLog(caseId: string): Promise<AuditEntry[]> {
  const response = await apiClient.get<AuditEntry[]>(`/cases/${caseId}/audit`)
  return response.data
}
