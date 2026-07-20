import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'sauron'

const STORAGE_KEY = 'theme'

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'sauron' ? stored : 'dark'
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getInitialTheme(),

  setTheme: (theme: Theme) => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
    set({ theme })
  },
}))

// Apply immediately on module load so the correct theme is set before first paint.
applyTheme(useThemeStore.getState().theme)
