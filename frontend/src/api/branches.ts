import apiClient from './client'
import type { Branch, CreateBranchData, Comment, CreateCommentData } from '../types'

export async function getBranches(caseId: string): Promise<Branch[]> {
  const response = await apiClient.get<Branch[]>(`/cases/${caseId}/branches`)
  return response.data
}

export async function createBranch(caseId: string, data: CreateBranchData): Promise<Branch> {
  const response = await apiClient.post<Branch>(`/cases/${caseId}/branches`, data)
  return response.data
}

export async function updateBranch(
  branchId: string,
  data: Partial<CreateBranchData> & { status?: string; status_reason?: string },
): Promise<Branch> {
  const response = await apiClient.put<Branch>(`/branches/${branchId}`, data)
  return response.data
}

export async function mergeBranch(branchId: string): Promise<void> {
  await apiClient.post(`/branches/${branchId}/merge`)
}

export async function deleteBranch(branchId: string): Promise<void> {
  await apiClient.delete(`/branches/${branchId}`)
}

export async function getBranchComments(branchId: string): Promise<Comment[]> {
  const response = await apiClient.get<Comment[]>(`/branches/${branchId}/comments`)
  return response.data
}

export async function createBranchComment(
  branchId: string,
  data: CreateCommentData,
): Promise<Comment> {
  const response = await apiClient.post<Comment>(`/branches/${branchId}/comments`, data)
  return response.data
}
