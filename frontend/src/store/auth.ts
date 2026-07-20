import { create } from 'zustand'
import type { User } from '../types'
import { login as apiLogin, logout as apiLogout, getMe } from '../api/auth'
import { setAuthToken } from '../api/client'

interface AuthState {
  user: User | null
  accessToken: string | null
  isLoading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  restoreSession: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isLoading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const token = await apiLogin(username, password)
      setAuthToken(token.access_token)
      localStorage.setItem('refresh_token', token.refresh_token)
      const user = await getMe()
      set({
        user,
        accessToken: token.access_token,
        isLoading: false,
        error: null,
      })
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Ошибка авторизации. Проверьте логин и пароль.'
      set({ isLoading: false, error: message, user: null, accessToken: null })
      throw err
    }
  },

  logout: () => {
    apiLogout().catch(() => {})
    setAuthToken(null)
    localStorage.removeItem('refresh_token')
    set({ user: null, accessToken: null, error: null })
  },

  restoreSession: async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      set({ isLoading: false })
      return
    }

    set({ isLoading: true })
    try {
      setAuthToken(token)
      const user = await getMe()
      // interceptor мог обновить токен через refresh — читаем актуальный из localStorage
      const currentToken = localStorage.getItem('access_token') ?? token
      set({ user, accessToken: currentToken, isLoading: false })
    } catch {
      setAuthToken(null)
      localStorage.removeItem('refresh_token')
      set({ user: null, accessToken: null, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
