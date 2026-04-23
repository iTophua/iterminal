import { create } from 'zustand'
import type { AppTheme, AppThemeMode, TerminalThemeName, ThemeName, ThemePersistData } from '../types/theme'

const STORAGE_KEY = 'iterminal_theme'
const CURRENT_VERSION = 3

export const getSystemTheme = (): AppTheme => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

const loadPersistedTheme = (): ThemePersistData | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.version === CURRENT_VERSION || parsed.version === 2 || parsed.version === 1) {
        if (parsed.version === 1 && parsed.appTheme) {
          return {
            appThemeMode: parsed.appTheme,
            appTheme: parsed.appTheme,
            selectedTheme: 'default',
            terminalTheme: parsed.terminalTheme,
            version: CURRENT_VERSION,
          }
        }
        if (parsed.version === 2) {
          return {
            ...parsed,
            selectedTheme: (parsed.selectedTheme as ThemeName) || 'default',
            version: CURRENT_VERSION,
          }
        }
        return parsed
      }
    }
  } catch {
  }
  return null
}

const persistTheme = (data: ThemePersistData) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
  }
}

interface ThemeState {
  appThemeMode: AppThemeMode
  appTheme: AppTheme
  selectedTheme: ThemeName
  terminalTheme: TerminalThemeName | null
  hydrated: boolean
  
  setAppThemeMode: (mode: AppThemeMode) => void
  setSelectedTheme: (theme: ThemeName) => void
  setTerminalTheme: (theme: TerminalThemeName | null) => void
  resetTerminalTheme: () => void
  hydrate: () => void
  updateSystemTheme: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  appThemeMode: 'system',
  appTheme: getSystemTheme(),
  selectedTheme: 'default',
  terminalTheme: null,
  hydrated: false,
  
  setAppThemeMode: (mode) => {
    const resolvedTheme = mode === 'system' ? getSystemTheme() : mode
    set({ appThemeMode: mode, appTheme: resolvedTheme })
    persistTheme({
      appThemeMode: mode,
      appTheme: resolvedTheme,
      selectedTheme: get().selectedTheme,
      terminalTheme: get().terminalTheme,
      version: CURRENT_VERSION,
    })
  },
  
  setSelectedTheme: (theme) => {
    set({ selectedTheme: theme })
    const state = get()
    persistTheme({
      appThemeMode: state.appThemeMode,
      appTheme: state.appTheme,
      selectedTheme: theme,
      terminalTheme: state.terminalTheme,
      version: CURRENT_VERSION,
    })
  },
  
  setTerminalTheme: (theme) => {
    set({ terminalTheme: theme })
    const state = get()
    persistTheme({
      appThemeMode: state.appThemeMode,
      appTheme: state.appTheme,
      selectedTheme: state.selectedTheme,
      terminalTheme: theme,
      version: CURRENT_VERSION,
    })
  },
  
  resetTerminalTheme: () => {
    set({ terminalTheme: null })
    const state = get()
    persistTheme({
      appThemeMode: state.appThemeMode,
      appTheme: state.appTheme,
      selectedTheme: state.selectedTheme,
      terminalTheme: null,
      version: CURRENT_VERSION,
    })
  },
  
  hydrate: () => {
    if (get().hydrated) return
    
    const persisted = loadPersistedTheme()
    if (persisted) {
      const resolvedTheme = persisted.appThemeMode === 'system' 
        ? getSystemTheme() 
        : (persisted.appThemeMode || persisted.appTheme)
      set({
        appThemeMode: persisted.appThemeMode || persisted.appTheme,
        appTheme: resolvedTheme,
        selectedTheme: persisted.selectedTheme || 'default',
        terminalTheme: persisted.terminalTheme,
        hydrated: true,
      })
    } else {
      set({
        appThemeMode: 'system',
        appTheme: getSystemTheme(),
        selectedTheme: 'default',
        terminalTheme: null,
        hydrated: true,
      })
    }
  },
  
  updateSystemTheme: () => {
    const state = get()
    if (state.appThemeMode === 'system') {
      const newTheme = getSystemTheme()
      if (newTheme !== state.appTheme) {
        set({ appTheme: newTheme })
        persistTheme({
          appThemeMode: state.appThemeMode,
          appTheme: newTheme,
          selectedTheme: state.selectedTheme,
          terminalTheme: state.terminalTheme,
          version: CURRENT_VERSION,
        })
      }
    }
  },
}))
