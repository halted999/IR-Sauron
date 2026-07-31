import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'sauron' | 'elves'

const STORAGE_KEY = 'theme'

const FAVICON_BY_THEME: Partial<Record<Theme, string>> = {
  elves: '/favicon-leaf.svg',
}
const DEFAULT_FAVICON = '/favicon.svg'

function applyFavicon(theme: Theme) {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (link) {
    link.href = FAVICON_BY_THEME[theme] ?? DEFAULT_FAVICON
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  applyFavicon(theme)
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'sauron' || stored === 'elves'
    ? stored
    : 'dark'
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
