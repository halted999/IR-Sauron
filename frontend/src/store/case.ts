import { create } from 'zustand'
import type { Case, Branch, Event, IOC } from '../types'
import { getCasesPaged, getCase as apiGetCase } from '../api/cases'
import type { CasesParams } from '../api/cases'
import { getBranches as apiGetBranches } from '../api/branches'
import { getEvents as apiGetEvents } from '../api/events'
import { getIOCs as apiGetIOCs } from '../api/iocs'

interface CaseState {
  cases: Case[]
  total: number
  currentCase: Case | null
  branches: Branch[]
  currentBranch: Branch | null
  events: Event[]
  iocs: IOC[]
  isLoading: boolean
  error: string | null

  fetchCases: (params?: CasesParams) => Promise<void>
  fetchCase: (id: string) => Promise<void>
  setCurrentCase: (c: Case | null) => void
  fetchBranches: (caseId: string) => Promise<void>
  setCurrentBranch: (branch: Branch | null) => void
  fetchEvents: (branchId: string) => Promise<void>
  fetchIOCs: (caseId: string) => Promise<void>
  addEvent: (event: Event) => void
  updateEventInStore: (event: Event) => void
  removeEvent: (eventId: string) => void
  addBranch: (branch: Branch) => void
  updateBranchInStore: (branch: Branch) => void
  addIOC: (ioc: IOC) => void
  removeIOC: (iocId: string) => void
  clearCaseData: () => void
}

export const useCaseStore = create<CaseState>((set, get) => ({
  cases: [],
  total: 0,
  currentCase: null,
  branches: [],
  currentBranch: null,
  events: [],
  iocs: [],
  isLoading: false,
  error: null,

  fetchCases: async (params) => {
    set({ isLoading: true, error: null })
    try {
      const { items, total } = await getCasesPaged(params)
      set({ cases: items, total, isLoading: false })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки дел'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  fetchCase: async (id: string) => {
    set({ isLoading: true, error: null })
    try {
      const currentCase = await apiGetCase(id)
      set({ currentCase, isLoading: false })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки дела'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  setCurrentCase: (c: Case | null) => set({ currentCase: c }),

  fetchBranches: async (caseId: string) => {
    set({ isLoading: true, error: null })
    try {
      const branches = await apiGetBranches(caseId)
      set({ branches, isLoading: false })

      const currentBranch = get().currentBranch
      if (!currentBranch && branches.length > 0) {
        const mainBranch = branches.find((b) => b.is_main) ?? branches[0]
        set({ currentBranch: mainBranch })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки веток'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  setCurrentBranch: (branch: Branch | null) => set({ currentBranch: branch }),

  fetchEvents: async (branchId: string) => {
    set({ isLoading: true, error: null })
    try {
      const events = await apiGetEvents(branchId)
      set({ events, isLoading: false })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки событий'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  fetchIOCs: async (caseId: string) => {
    try {
      const iocs = await apiGetIOCs(caseId)
      set({ iocs })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки IOC'
      set({ error: message })
    }
  },

  addEvent: (event: Event) =>
    set((state) => ({
      events: [...state.events, event].sort(
        (a, b) => new Date(a.event_ts).getTime() - new Date(b.event_ts).getTime(),
      ),
    })),

  updateEventInStore: (event: Event) =>
    set((state) => ({
      events: state.events.map((e) => (e.id === event.id ? event : e)),
    })),

  removeEvent: (eventId: string) =>
    set((state) => ({
      events: state.events.filter((e) => e.id !== eventId),
    })),

  addBranch: (branch: Branch) =>
    set((state) => ({ branches: [...state.branches, branch] })),

  updateBranchInStore: (branch: Branch) =>
    set((state) => ({
      branches: state.branches.map((b) => (b.id === branch.id ? branch : b)),
    })),

  addIOC: (ioc: IOC) =>
    set((state) => ({ iocs: [...state.iocs, ioc] })),

  removeIOC: (iocId: string) =>
    set((state) => ({ iocs: state.iocs.filter((i) => i.id !== iocId) })),

  clearCaseData: () =>
    set({
      currentCase: null,
      branches: [],
      currentBranch: null,
      events: [],
      iocs: [],
      error: null,
    }),
}))
