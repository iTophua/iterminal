import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme, App as AntdApp } from 'antd'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { setTheme as setAppTheme } from '@tauri-apps/api/app'
import { useThemeStore } from '../stores/themeStore'
import type { AppTheme } from '../types/theme'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface ThemeProviderProps {
  children: ReactNode
}

async function applyTauriTheme(theme: AppTheme | null) {
  try {
    await setAppTheme(theme)
  } catch (error) {
    console.warn('Failed to set app theme:', error)
  }
}

function applyThemeToDOM(theme: AppTheme) {
  document.documentElement.setAttribute('data-theme', theme)
}

function disableTransitions() {
  document.documentElement.classList.add('theme-transitioning')
}

function enableTransitions() {
  document.documentElement.classList.remove('theme-transitioning')
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
    
    disableTransitions()
    applyThemeToDOM(appTheme)
    applyTauriTheme(appThemeMode === 'system' ? null : appTheme)
    
    const timer = requestAnimationFrame(() => {
      enableTransitions()
    })
    
    return () => {
      cancelAnimationFrame(timer)
      enableTransitions()
    }
  }, [appTheme, appThemeMode, hydrated])
  
  useEffect(() => {
    if (appThemeMode !== 'system') return
    
    let unlisten: (() => void) | null = null
    
    const handleThemeChange = (newTheme: AppTheme) => {
      disableTransitions()
      applyThemeToDOM(newTheme)
      useThemeStore.setState({ appTheme: newTheme })
      const state = useThemeStore.getState()
      localStorage.setItem('iterminal_theme', JSON.stringify({
        appThemeMode: state.appThemeMode,
        appTheme: newTheme,
        terminalTheme: state.terminalTheme,
        version: 2,
      }))
      requestAnimationFrame(enableTransitions)
    }
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaQueryChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const newTheme: AppTheme = e.matches ? 'dark' : 'light'
      const storeTheme = useThemeStore.getState().appTheme
      if (newTheme !== storeTheme) {
        handleThemeChange(newTheme)
      }
    }
    
    mediaQuery.addEventListener('change', handleMediaQueryChange)
    
    const setupListener = async () => {
      try {
        const mainWindow = getCurrentWindow()
        unlisten = await mainWindow.onThemeChanged(({ payload: theme }) => {
          const newTheme = theme as AppTheme
          const storeTheme = useThemeStore.getState().appTheme
          if (newTheme !== storeTheme) {
            handleThemeChange(newTheme)
          }
        })
      } catch {}
    }
    
    setupListener()
    
    return () => {
      mediaQuery.removeEventListener('change', handleMediaQueryChange)
      if (unlisten) {
        unlisten()
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
          Tabs: {
            itemSelectedColor: '#00b96b',
            itemHoverColor: appTheme === 'dark' ? '#1cc77a' : '#00a35e',
            itemActiveColor: '#00b96b',
            inkBarColor: '#00b96b',
          },
        },
      }}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}