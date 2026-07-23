import { create } from 'zustand'
import type { Alert } from '../types'
import { getAlertsPaged } from '../api/alerts'
import type { AlertsParams } from '../api/alerts'

interface AlertState {
  alerts: Alert[]
  total: number
  isLoading: boolean
  error: string | null

  fetchAlerts: (params?: AlertsParams) => Promise<void>
  addAlert: (alert: Alert) => void
  updateAlertInStore: (alert: Alert) => void
  removeAlertsFromStore: (ids: string[]) => void
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  total: 0,
  isLoading: false,
  error: null,

  fetchAlerts: async (params) => {
    set({ isLoading: true, error: null })
    try {
      const { items, total } = await getAlertsPaged(params)
      set({ alerts: items, total, isLoading: false })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки алертов'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  addAlert: (alert: Alert) =>
    set((state) => ({ alerts: [alert, ...state.alerts], total: state.total + 1 })),

  updateAlertInStore: (alert: Alert) =>
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === alert.id ? alert : a)),
    })),

  removeAlertsFromStore: (ids: string[]) => {
    const idSet = new Set(ids)
    set((state) => ({
      alerts: state.alerts.filter((a) => !idSet.has(a.id)),
      total: Math.max(0, state.total - ids.length),
    }))
  },
}))
