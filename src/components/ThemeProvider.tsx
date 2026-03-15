import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme, App as AntdApp } from 'antd'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useThemeStore } from '../stores/themeStore'
import type { AppTheme } from '../types/theme'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface ThemeProviderProps {
  children: ReactNode
}

async function setWindowTheme(theme: AppTheme) {
  try {
    const mainWindow = getCurrentWindow()
    await mainWindow.setTheme(theme)
  } catch {
  }
}

function applyThemeToDOM(theme: AppTheme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const appTheme = useThemeStore(s => s.appTheme)
  const appThemeMode = useThemeStore(s => s.appThemeMode)
  const hydrate = useThemeStore(s => s.hydrate)
  const hydrated = useThemeStore(s => s.hydrated)
  
  useIsomorphicLayoutEffect(() => {
    hydrate()
  }, [hydrate])
  
  useEffect(() => {
    if (!hydrated) return
    
    applyThemeToDOM(appTheme)
    setWindowTheme(appTheme)
  }, [appTheme, hydrated])
  
  useEffect(() => {
    if (appThemeMode !== 'system') return
    
    let unlisten: (() => void) | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null
    
    const handleThemeChange = (newTheme: AppTheme) => {
      applyThemeToDOM(newTheme)
      setWindowTheme(newTheme)
      useThemeStore.setState({ appTheme: newTheme })
      const state = useThemeStore.getState()
      localStorage.setItem('iterminal_theme', JSON.stringify({
        appThemeMode: state.appThemeMode,
        appTheme: newTheme,
        terminalTheme: state.terminalTheme,
        version: 2,
      }))
    }
    
    const setupListener = async () => {
      try {
        const mainWindow = getCurrentWindow()
        unlisten = await mainWindow.onThemeChanged(({ payload: theme }) => {
          handleThemeChange(theme as AppTheme)
        })
      } catch {}
    }
    
    setupListener()
    
    pollInterval = setInterval(async () => {
      try {
        const mainWindow = getCurrentWindow()
        const currentTheme = await mainWindow.theme()
        const newTheme = currentTheme as AppTheme
        const storeTheme = useThemeStore.getState().appTheme
        if (newTheme !== storeTheme) {
          handleThemeChange(newTheme)
        }
      } catch {}
    }, 1000)
    
    return () => {
      if (unlisten) {
        unlisten()
      }
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [appThemeMode])
  
  if (!hydrated) {
    return null
  }
  
  return (
    <ConfigProvider
      theme={{
        algorithm: appTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#00b96b',
          borderRadius: 6,
        },
        components: {
          Tree: {
            nodeSelectedBg: 'rgba(0, 185, 107, 0.15)',
            nodeSelectedColor: appTheme === 'dark' ? '#fff' : 'rgba(0, 0, 0, 0.88)',
            directoryNodeSelectedBg: 'rgba(0, 185, 107, 0.15)',
            directoryNodeSelectedColor: appTheme === 'dark' ? '#fff' : 'rgba(0, 0, 0, 0.88)',
          },
        },
      }}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}