import apiClient from './client'
import type { Case, CreateCaseData, VerificationStatus } from '../types'

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
  verification_status?: VerificationStatus
  root_cause?: string
  impact_summary?: string
  attribution?: string
  incident_started_at?: string | null
  incident_contained_at?: string | null
  incident_closed_at?: string | null
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

