import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme, App as AntdApp } from 'antd'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { setTheme as setAppTheme } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { useThemeStore } from '../stores/themeStore'
import { themes } from '../styles/themes/app-themes'
import type { AppTheme, ThemeName } from '../types/theme'

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

async function applyWindowBackground(color: string) {
  try {
    await invoke('set_window_background_color', { color })
  } catch (error) {
    console.warn('Failed to set window background:', error)
  }
}

function applyThemeToDOM(mode: AppTheme, colorTheme: ThemeName) {
  document.documentElement.setAttribute('data-theme', mode)
  document.documentElement.setAttribute('data-color-theme', colorTheme)
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
  const selectedTheme = useThemeStore(s => s.selectedTheme)
  const hydrate = useThemeStore(s => s.hydrate)
  const hydrated = useThemeStore(s => s.hydrated)
  
  const currentThemeDef = themes[selectedTheme]
  
  useIsomorphicLayoutEffect(() => {
    hydrate()
  }, [hydrate])
  
  useEffect(() => {
    if (!hydrated) return
    
    disableTransitions()
    applyThemeToDOM(appTheme, selectedTheme)
    applyTauriTheme(appThemeMode === 'system' ? null : appTheme)
    
    const bgColor = currentThemeDef.colors[appTheme]['--color-bg-base']
    if (bgColor && bgColor.startsWith('#')) {
      applyWindowBackground(bgColor)
    }
    
    const timer = requestAnimationFrame(() => {
      enableTransitions()
    })
    
    return () => {
      cancelAnimationFrame(timer)
      enableTransitions()
    }
  }, [appTheme, appThemeMode, selectedTheme, hydrated])
  
  useEffect(() => {
    if (appThemeMode !== 'system') return
    
    let unlisten: (() => void) | null = null
    
    const handleThemeChange = (newTheme: AppTheme) => {
      disableTransitions()
      applyThemeToDOM(newTheme, selectedTheme)
      useThemeStore.setState({ appTheme: newTheme })
      
      const themeDef = themes[selectedTheme]
      const bgColor = themeDef.colors[newTheme]['--color-bg-base']
      if (bgColor && bgColor.startsWith('#')) {
        applyWindowBackground(bgColor)
      }
      
      const state = useThemeStore.getState()
      localStorage.setItem('iterminal_theme', JSON.stringify({
        appThemeMode: state.appThemeMode,
        appTheme: newTheme,
        selectedTheme: state.selectedTheme,
        terminalTheme: state.terminalTheme,
        version: 3,
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
  }, [appThemeMode, selectedTheme])
  
  if (!hydrated) {
    return null
  }
  
  return (
    <ConfigProvider
      theme={{
        algorithm: appTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: currentThemeDef.antdPrimary,
          borderRadius: 6,
          fontSize: 13,
          fontSizeSM: 12,
          fontSizeLG: 14,
        },
        components: {
          Tree: {
            nodeSelectedBg: `${currentThemeDef.antdPrimary}26`,
            nodeSelectedColor: appTheme === 'dark' ? '#fff' : 'rgba(0, 0, 0, 0.88)',
            directoryNodeSelectedBg: `${currentThemeDef.antdPrimary}26`,
            directoryNodeSelectedColor: appTheme === 'dark' ? '#fff' : 'rgba(0, 0, 0, 0.88)',
          },
          Tabs: {
            itemSelectedColor: currentThemeDef.antdPrimary,
            itemHoverColor: currentThemeDef.antdPrimaryHover[appTheme],
            itemActiveColor: currentThemeDef.antdPrimary,
            inkBarColor: currentThemeDef.antdPrimary,
          },
        },
      }}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}
