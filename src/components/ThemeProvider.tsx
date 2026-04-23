import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme, App as AntdApp } from 'antd'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { setTheme as setAppTheme } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { useThemeStore, getSystemTheme } from '../stores/themeStore'
import { themes } from '../styles/themes/app-themes'
import type { AppTheme, ThemeName, ThemeVariableSet } from '../types/theme'

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

/**
 * 应用主题到 DOM：
 * 1. 设置 data-theme / data-color-theme / data-material 属性
 * 2. 注入完整 CSS 变量集到 document.documentElement.style
 * 3. 清理上一主题遗留的变量
 */
function applyThemeToDOM(mode: AppTheme, colorTheme: ThemeName, variables: ThemeVariableSet) {
  const root = document.documentElement

  // 设置主题属性
  root.setAttribute('data-theme', mode)
  root.setAttribute('data-color-theme', colorTheme)

  // 注入材质属性
  const themeDef = themes[colorTheme]
  root.setAttribute('data-material', themeDef.material.name)

  // 注入所有 CSS 变量
  Object.entries(variables).forEach(([key, value]) => {
    root.style.setProperty(key, value)
  })
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
  
  const currentThemeDef = themes[selectedTheme] ?? themes.default
  
  useIsomorphicLayoutEffect(() => {
    hydrate()
  }, [hydrate])
  
  useEffect(() => {
    if (!hydrated) return

    disableTransitions()
    applyThemeToDOM(appTheme, selectedTheme, currentThemeDef.colors[appTheme])
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
  }, [appTheme, appThemeMode, selectedTheme, hydrated, currentThemeDef])
  
  useEffect(() => {
    if (appThemeMode !== 'system') return
    
    let unlisten: (() => void) | null = null
    
    const handleThemeChange = (newTheme: AppTheme) => {
      disableTransitions()
      const themeDef = themes[selectedTheme] ?? themes.default
      applyThemeToDOM(newTheme, selectedTheme, themeDef.colors[newTheme])
      useThemeStore.setState({ appTheme: newTheme })

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

  // 跨窗口同步：主窗口切换主题后，新窗口通过 storage 事件更新 store
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== 'iterminal_theme' || !e.newValue) return
      try {
        const data = JSON.parse(e.newValue)
        if (data.version !== 3) return
        const resolvedTheme = data.appThemeMode === 'system' ? getSystemTheme() : data.appThemeMode
        useThemeStore.setState({
          appThemeMode: data.appThemeMode,
          appTheme: resolvedTheme,
          selectedTheme: data.selectedTheme,
          terminalTheme: data.terminalTheme,
        })
      } catch {}
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])
  
  if (!hydrated) {
    return null
  }
  
  const themeColors = currentThemeDef.colors[appTheme]
  const bgBase = themeColors['--color-bg-base']
  const bgContainer = themeColors['--color-bg-container']
  const bgElevated = themeColors['--color-bg-elevated']
  const colorText = themeColors['--color-text']
  const colorTextSecondary = themeColors['--color-text-secondary']
  const colorTextQuaternary = themeColors['--color-text-quaternary'] || (appTheme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)')
  const colorBorder = themeColors['--color-border']
  const colorBorderSecondary = themeColors['--color-border-secondary']

  return (
    <ConfigProvider
      theme={{
        algorithm: appTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: currentThemeDef.antdPrimary,
          colorBgBase: bgBase,
          colorBgContainer: bgContainer,
          colorBgElevated: bgElevated,
          colorText: colorText,
          colorTextSecondary: colorTextSecondary,
          colorBorder: colorBorder,
          colorBorderSecondary: colorBorderSecondary,
          borderRadius: 8,
          borderRadiusSM: 6,
          borderRadiusLG: 10,
          fontSize: 13,
          fontSizeSM: 12,
          fontSizeLG: 14,
          motionDurationFast: '0.2s',
          motionDurationMid: '0.3s',
          motionDurationSlow: '0.4s',
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
          Card: {
            colorBgContainer: bgElevated,
            colorBorderSecondary: colorBorderSecondary,
            borderRadiusLG: 10,
            boxShadow: appTheme === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.08)',
            boxShadowSecondary: appTheme === 'dark'
              ? '0 8px 24px rgba(0, 0, 0, 0.4)'
              : '0 8px 24px rgba(0, 0, 0, 0.12)',
          },
          Button: {
            borderRadius: 6,
            borderRadiusSM: 4,
            defaultBg: bgElevated,
            defaultColor: colorText,
            defaultBorderColor: colorBorder,
            defaultHoverBg: bgContainer,
            defaultHoverBorderColor: currentThemeDef.antdPrimary,
            defaultHoverColor: currentThemeDef.antdPrimaryHover[appTheme],
            defaultActiveBg: bgBase,
            defaultActiveBorderColor: currentThemeDef.antdPrimaryActive[appTheme],
            primaryShadow: `0 2px 8px ${currentThemeDef.antdPrimary}40`,
          },
          Input: {
            colorBgContainer: bgContainer,
            colorBorder: colorBorder,
            colorText: colorText,
            activeBorderColor: currentThemeDef.antdPrimary,
            hoverBorderColor: currentThemeDef.antdPrimaryHover[appTheme],
            activeShadow: `0 0 0 2px ${currentThemeDef.antdPrimary}20`,
            borderRadius: 6,
          },
          Modal: {
            contentBg: bgContainer,
            headerBg: bgContainer,
            footerBg: bgContainer,
            titleColor: colorText,
            titleFontSize: 15,
            borderRadiusLG: 12,
            boxShadow: appTheme === 'dark'
              ? '0 20px 48px rgba(0, 0, 0, 0.5)'
              : '0 20px 48px rgba(0, 0, 0, 0.15)',
          },
          Menu: {
            itemBg: 'transparent',
            itemColor: colorTextSecondary,
            itemHoverBg: `${currentThemeDef.antdPrimary}10`,
            itemHoverColor: currentThemeDef.antdPrimary,
            itemSelectedBg: `${currentThemeDef.antdPrimary}15`,
            itemSelectedColor: currentThemeDef.antdPrimary,
            itemActiveBg: `${currentThemeDef.antdPrimary}08`,
            subMenuItemBg: 'transparent',
            itemBorderRadius: 6,
            itemMarginInline: 8,
            itemMarginBlock: 4,
          },
          Select: {
            colorBgContainer: bgContainer,
            colorBorder: colorBorder,
            colorText: colorText,
            activeBorderColor: currentThemeDef.antdPrimary,
            hoverBorderColor: currentThemeDef.antdPrimaryHover[appTheme],
            activeOutlineColor: `${currentThemeDef.antdPrimary}20`,
            borderRadius: 6,
            optionSelectedBg: `${currentThemeDef.antdPrimary}18`,
            optionSelectedColor: colorText,
            optionActiveBg: `${currentThemeDef.antdPrimary}0D`,
            selectorBg: bgContainer,
          },
          Tag: {
            borderRadiusSM: 4,
            defaultBg: bgElevated,
            defaultColor: colorTextSecondary,
            borderRadius: 4,
          },
          Badge: {
            colorError: '#ff4d4f',
            colorSuccess: '#52c41a',
            colorWarning: '#faad14',
            colorInfo: currentThemeDef.antdPrimary,
          },
          Slider: {
            trackBg: currentThemeDef.antdPrimary,
            trackHoverBg: currentThemeDef.antdPrimaryHover[appTheme],
            handleColor: currentThemeDef.antdPrimary,
            handleActiveColor: currentThemeDef.antdPrimaryActive[appTheme],
            dotActiveBorderColor: currentThemeDef.antdPrimary,
            railBg: colorBorderSecondary,
            railHoverBg: colorBorder,
          },
          Switch: {
            colorPrimary: currentThemeDef.antdPrimary,
            colorPrimaryHover: currentThemeDef.antdPrimaryHover[appTheme],
          },
          Tooltip: {
            colorBgSpotlight: appTheme === 'dark' ? '#2a2a2a' : '#333',
            colorTextLightSolid: '#fff',
            borderRadius: 6,
          },
          Divider: {
            colorSplit: colorBorderSecondary,
          },
          Drawer: {
            colorBgElevated: bgContainer,
            colorIcon: colorTextSecondary,
            colorIconHover: currentThemeDef.antdPrimary,
          },
          Dropdown: {
            colorBgElevated: bgElevated,
            controlItemBgHover: `${currentThemeDef.antdPrimary}10`,
            controlItemBgActive: `${currentThemeDef.antdPrimary}18`,
          },
          Spin: {
            colorPrimary: currentThemeDef.antdPrimary,
          },
          Progress: {
            colorInfo: currentThemeDef.antdPrimary,
            remainingColor: colorBorderSecondary,
          },
          Table: {
            colorBgContainer: bgContainer,
            colorFillAlter: bgElevated,
            colorFillContent: bgElevated,
            borderColor: colorBorder,
            headerBg: bgElevated,
            headerColor: colorText,
            headerSplitColor: colorBorder,
            rowHoverBg: `${currentThemeDef.antdPrimary}08`,
            rowSelectedBg: `${currentThemeDef.antdPrimary}12`,
            rowSelectedHoverBg: `${currentThemeDef.antdPrimary}18`,
            colorText: colorText,
            colorTextSecondary: colorTextSecondary,
            cellPaddingBlockSM: 4,
            cellPaddingInlineSM: 8,
          },
          Radio: {
            colorPrimary: currentThemeDef.antdPrimary,
            buttonCheckedBg: `${currentThemeDef.antdPrimary}20`,
            buttonSolidCheckedBg: currentThemeDef.antdPrimary,
            buttonSolidCheckedHoverBg: currentThemeDef.antdPrimaryHover[appTheme],
            buttonSolidCheckedColor: '#ffffff',
          },
          Checkbox: {
            colorPrimary: currentThemeDef.antdPrimary,
            colorPrimaryHover: currentThemeDef.antdPrimaryHover[appTheme],
            colorPrimaryBorder: currentThemeDef.antdPrimary,
          },
          Upload: {
            colorPrimary: currentThemeDef.antdPrimary,
            colorPrimaryHover: currentThemeDef.antdPrimaryHover[appTheme],
          },
          Skeleton: {
            color: colorBorderSecondary,
            colorGradientEnd: colorBorder,
          },
          Empty: {
            colorText: colorTextSecondary,
            colorTextDisabled: colorTextQuaternary,
          },
          App: {
            colorText: colorText,
            colorTextSecondary: colorTextSecondary,
          },
        },
      }}
    >
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}
