import apiClient from './client'
import type { User } from '../types'

export interface UpdateUserData {
  email?: string
  full_name?: string
  password?: string
}

export async function getUser(id: string): Promise<User> {
  const response = await apiClient.get<User>(`/users/${id}`)
  return response.data
}

export async function updateUser(id: string, data: UpdateUserData): Promise<User> {
  const response = await apiClient.put<User>(`/users/${id}`, data)
  return response.data
}
