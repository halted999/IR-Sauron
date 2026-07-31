import { create } from 'zustand'

export interface MaintenanceProgress {
  processed: number
  total: number
}

interface MaintenanceState {
  isActive: boolean
  reason: string
  progress: MaintenanceProgress | null
  error: string | null
  setActive: (active: boolean, reason?: string) => void
  setProgress: (progress: MaintenanceProgress | null) => void
  setError: (error: string | null) => void
}

export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  isActive: false,
  reason: '',
  progress: null,
  error: null,
  setActive: (active, reason = '') => set({ isActive: active, reason }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
}))
