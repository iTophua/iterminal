import { createContext, useContext, useEffect, ReactNode } from 'react'
import { useThemeStore, AppTheme } from '../stores/themeStore'
import type { ThemeContextValue } from '../types/theme'

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { appThemeMode, appTheme, setThemeMode, setSystemTheme } = useThemeStore()

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e: MediaQueryListEvent) => {
      const currentMode = useThemeStore.getState().appThemeMode
      console.log('[ThemeProvider] System theme changed:', e.matches ? 'dark' : 'light', 'current mode:', currentMode)
      if (currentMode === 'system') {
        setSystemTheme(e.matches ? 'dark' : 'light')
      }
    }

    // 如果当前是 system 模式，立即同步
    if (appThemeMode === 'system') {
      const systemTheme: AppTheme = mediaQuery.matches ? 'dark' : 'light'
      console.log('[ThemeProvider] Syncing system theme on init:', systemTheme)
      setSystemTheme(systemTheme)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [appThemeMode, setSystemTheme])

  useEffect(() => {
    console.log('[ThemeProvider] Applying theme:', appTheme)
    document.documentElement.setAttribute('data-theme', appTheme)

    const applyTauriTheme = async () => {
      try {
        const tauriWindow = await import('@tauri-apps/api/window')
        const appWindow = tauriWindow.getCurrentWindow()
        await appWindow.setTheme(appTheme)
        console.log('[ThemeProvider] Tauri theme set to:', appTheme)
      } catch (error) {
        console.warn('[ThemeProvider] Tauri setTheme error:', error)
      }
    }
    applyTauriTheme()
  }, [appTheme])

  const value: ThemeContextValue = {
    mode: appTheme,
    preferences: {
      mode: appThemeMode === 'system' ? 'light' : appThemeMode,
      followSystem: appThemeMode === 'system',
      accentColor: 'var(--iterminal-primary)',
    },
    setMode: (mode: 'light' | 'dark') => setThemeMode(mode),
    toggleMode: () => setThemeMode(appTheme === 'dark' ? 'light' : 'dark'),
    setPreferences: (prefs) => {
      if (prefs.followSystem) {
        setThemeMode('system')
      } else if (prefs.mode) {
        setThemeMode(prefs.mode as 'light' | 'dark')
      }
    },
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}