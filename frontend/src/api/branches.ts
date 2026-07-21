import apiClient from './client'
import type { Branch, Comment, CreateCommentData } from '../types'

export async function getBranches(caseId: string): Promise<Branch[]> {
  const response = await apiClient.get<Branch[]>(`/cases/${caseId}/branches`)
  return response.data
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
