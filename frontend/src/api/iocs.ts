import apiClient from './client'
import type { IOC, CreateIOCData } from '../types'

export async function getIOCs(caseId: string): Promise<IOC[]> {
  const response = await apiClient.get<IOC[]>(`/cases/${caseId}/iocs`)
  return response.data
}

export async function createIOC(caseId: string, data: CreateIOCData): Promise<IOC> {
  const response = await apiClient.post<IOC>(`/cases/${caseId}/iocs`, data)
  return response.data
}

export async function deleteIOC(iocId: string): Promise<void> {
  await apiClient.delete(`/iocs/${iocId}`)
}

export async function linkIOC(iocId: string, eventId: string): Promise<void> {
  await apiClient.post(`/iocs/${iocId}/link/${eventId}`)
}

export async function unlinkIOC(iocId: string, eventId: string): Promise<void> {
  await apiClient.delete(`/iocs/${iocId}/link/${eventId}`)
}
