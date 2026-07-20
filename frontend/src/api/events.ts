import apiClient from './client'
import type { Event, Artifact, Comment, CreateEventData, CreateCommentData } from '../types'

export async function getEvents(branchId: string): Promise<Event[]> {
  const response = await apiClient.get<Event[]>(`/branches/${branchId}/events`)
  return response.data
}

export async function createEvent(branchId: string, data: CreateEventData): Promise<Event> {
  const response = await apiClient.post<Event>(`/branches/${branchId}/events`, data)
  return response.data
}

export async function updateEvent(eventId: string, data: Partial<CreateEventData>): Promise<Event> {
  const response = await apiClient.put<Event>(`/events/${eventId}`, data)
  return response.data
}

export async function deleteEvent(eventId: string, reason: string): Promise<void> {
  await apiClient.delete(`/events/${eventId}`, { data: { reason } })
}

export async function getEventHistory(eventId: string): Promise<unknown[]> {
  const response = await apiClient.get<unknown[]>(`/events/${eventId}/history`)
  return response.data
}

export async function uploadArtifact(
  eventId: string,
  file: File,
  uploadSource?: string,
): Promise<Artifact> {
  const formData = new FormData()
  formData.append('file', file)
  if (uploadSource) {
    formData.append('upload_source', uploadSource)
  }
  const response = await apiClient.post<Artifact>(`/events/${eventId}/artifacts`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function getArtifactUrl(artifactId: string): Promise<string> {
  const response = await apiClient.get<{ download_url: string }>(`/artifacts/${artifactId}/download`)
  return response.data.download_url
}

export async function deleteArtifact(artifactId: string): Promise<void> {
  await apiClient.delete(`/artifacts/${artifactId}`)
}

export async function getComments(eventId: string): Promise<Comment[]> {
  const response = await apiClient.get<Comment[]>(`/events/${eventId}/comments`)
  return response.data
}

export async function createComment(eventId: string, data: CreateCommentData): Promise<Comment> {
  const response = await apiClient.post<Comment>(`/events/${eventId}/comments`, data)
  return response.data
}

export async function updateComment(commentId: string, body: string): Promise<Comment> {
  const response = await apiClient.put<Comment>(`/comments/${commentId}`, { body })
  return response.data
}

export async function deleteComment(commentId: string): Promise<void> {
  await apiClient.delete(`/comments/${commentId}`)
}

export async function resolveComment(commentId: string): Promise<Comment> {
  const response = await apiClient.patch<Comment>(`/comments/${commentId}/resolve`)
  return response.data
}
