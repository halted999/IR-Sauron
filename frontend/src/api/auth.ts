import apiClient from './client'
import type { Token, User } from '../types'

export async function login(username: string, password: string): Promise<Token> {
  const response = await apiClient.post<Token>('/auth/login', { username, password })
  return response.data
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem('refresh_token')
  if (refreshToken) {
    await apiClient.post('/auth/logout', { refresh_token: refreshToken }).catch(() => {})
  }
}

export async function refreshToken(refresh: string): Promise<Token> {
  const response = await apiClient.post<Token>('/auth/refresh', { refresh_token: refresh })
  return response.data
}

export async function getMe(): Promise<User> {
  const response = await apiClient.get<User>('/auth/me')
  return response.data
}
