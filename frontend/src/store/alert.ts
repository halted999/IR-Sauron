import { create } from 'zustand'
import type { Alert } from '../types'
import { getAlerts as apiGetAlerts } from '../api/alerts'
import type { AlertsParams } from '../api/alerts'

interface AlertState {
  alerts: Alert[]
  isLoading: boolean
  error: string | null

  fetchAlerts: (params?: AlertsParams) => Promise<void>
  addAlert: (alert: Alert) => void
  updateAlertInStore: (alert: Alert) => void
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  isLoading: false,
  error: null,

  fetchAlerts: async (params) => {
    set({ isLoading: true, error: null })
    try {
      const alerts = await apiGetAlerts(params)
      set({ alerts, isLoading: false })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки алертов'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  addAlert: (alert: Alert) => set((state) => ({ alerts: [alert, ...state.alerts] })),

  updateAlertInStore: (alert: Alert) =>
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === alert.id ? alert : a)),
    })),
}))
