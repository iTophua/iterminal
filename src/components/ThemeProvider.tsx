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

function getSystemTheme(): AppTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { appTheme, appThemeMode, hydrate, hydrated } = useThemeStore()
  
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
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = () => {
      const newTheme = getSystemTheme()
      useThemeStore.setState({ appTheme: newTheme })
      const state = useThemeStore.getState()
      const persisted = {
        appThemeMode: state.appThemeMode,
        appTheme: newTheme,
        terminalTheme: state.terminalTheme,
        version: 2,
      }
      try {
        localStorage.setItem('iterminal_theme', JSON.stringify(persisted))
      } catch {}
    }
    
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
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