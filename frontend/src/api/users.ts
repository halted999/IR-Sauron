import apiClient from './client'
import type { User, UserRole } from '../types'

export interface UpdateUserData {
  email?: string
  full_name?: string
  password?: string
  role?: UserRole
  is_active?: boolean
}

export interface CreateUserData {
  username: string
  email: string
  full_name?: string
  role: UserRole
  password: string
}

export async function getUsers(): Promise<User[]> {
  const response = await apiClient.get<User[]>('/users')
  return response.data
}

export async function getUser(id: string): Promise<User> {
  const response = await apiClient.get<User>(`/users/${id}`)
  return response.data
}

export async function createUser(data: CreateUserData): Promise<User> {
  const response = await apiClient.post<User>('/users', data)
  return response.data
}

export async function updateUser(id: string, data: UpdateUserData): Promise<User> {
  const response = await apiClient.put<User>(`/users/${id}`, data)
  return response.data
}

export async function deactivateUser(id: string): Promise<void> {
  await apiClient.delete(`/users/${id}`)
}

export async function deleteUserPermanently(id: string): Promise<void> {
  await apiClient.delete(`/users/${id}/permanent`)
}
