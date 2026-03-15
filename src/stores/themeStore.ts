import { create } from 'zustand'

// 应用主题模式：用户选择的偏好
export type AppThemeMode = 'light' | 'dark' | 'system'

// 实际应用的主题（system 会被解析为 light 或 dark）
export type AppTheme = 'light' | 'dark'

// 终端主题类型
export type TerminalThemeKey = 'classic' | 'solarized-dark' | 'solarized-light' | 'dracula' | 'one-dark'

// 主题状态接口
export interface IThemeState {
  appThemeMode: AppThemeMode
  appTheme: AppTheme
  terminalTheme: TerminalThemeKey
  setThemeMode: (mode: AppThemeMode) => void
  setSystemTheme: (theme: AppTheme) => void
  setTerminalTheme: (theme: TerminalThemeKey) => void
}

// localStorage 键名
const THEME_STORAGE_KEY = 'iterminal_theme'
const THEME_VERSION = 3

interface StoredTheme {
  version: number
  mode: AppThemeMode
  terminalTheme: TerminalThemeKey
}

// 获取浏览器首选颜色方案
function getSystemTheme(): AppTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

// 从 localStorage 加载主题设置
function loadThemeFromStorage(): { mode: AppThemeMode; terminalTheme: TerminalThemeKey } {
  const defaults = { mode: 'system' as AppThemeMode, terminalTheme: 'classic' as TerminalThemeKey }
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as StoredTheme
      if (parsed.version === THEME_VERSION) {
        return {
          mode: ['light', 'dark', 'system'].includes(parsed.mode) ? parsed.mode : defaults.mode,
          terminalTheme: parsed.terminalTheme || defaults.terminalTheme
        }
      }
    }
  } catch (error) {
    console.warn('[ThemeStore] 加载主题设置失败:', error)
  }
  return defaults
}

// 保存主题设置到 localStorage
function saveThemeToStorage(mode: AppThemeMode, terminalTheme: TerminalThemeKey): void {
  try {
    const data: StoredTheme = { version: THEME_VERSION, mode, terminalTheme }
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('[ThemeStore] 保存主题设置失败:', error)
  }
}

// 根据模式解析实际主题
function resolveTheme(mode: AppThemeMode): AppTheme {
  if (mode === 'system') {
    return getSystemTheme()
  }
  return mode
}

export const useThemeStore = create<IThemeState>((set, get) => {
  const loaded = loadThemeFromStorage()
  console.log('[ThemeStore] Initialized with:', loaded)
  
  return {
    appThemeMode: loaded.mode,
    appTheme: resolveTheme(loaded.mode),
    terminalTheme: loaded.terminalTheme,

    setThemeMode: (mode: AppThemeMode) => {
      console.log('[ThemeStore] setThemeMode called:', mode)
      saveThemeToStorage(mode, get().terminalTheme)
      set({ 
        appThemeMode: mode,
        appTheme: resolveTheme(mode)
      })
    },

    setSystemTheme: (theme: AppTheme) => {
      const currentMode = get().appThemeMode
      console.log('[ThemeStore] setSystemTheme called:', theme, 'currentMode:', currentMode)
      if (currentMode === 'system') {
        set({ appTheme: theme })
      }
    },

    setTerminalTheme: (theme: TerminalThemeKey) => {
      console.log('[ThemeStore] setTerminalTheme called:', theme)
      saveThemeToStorage(get().appThemeMode, theme)
      set({ terminalTheme: theme })
    },
  }
})