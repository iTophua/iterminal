/**
 * 主题类型定义
 */

/**
 * 应用主题模式
 */
export type AppThemeMode = 'light' | 'dark' | 'system'

export type AppTheme = 'light' | 'dark'

export type ThemeName = 'default' | 'bladerunner' | 'neontokyo' | 'quantum' | 'matrix' | 'cyber' | 'tokyo' | 'gruvbox' | 'aurora' | 'solarflare' | 'nord' | 'monokai' | 'github' | 'catppuccin'

/**
 * 终端预设主题名称
 */
export type TerminalThemeName = 
  | 'classic'
  | 'solarized-dark'
  | 'solarized-light'
  | 'dracula'
  | 'one-dark'

/**
 * 终端主题颜色配置
 * 用于 xterm.js 的 theme 属性
 */
export interface TerminalThemeColors {
  /** 默认前景色 */
  foreground: string
  /** 默认背景色 */
  background: string
  /** 光标颜色 */
  cursor: string
  /** 光标背景色（accent颜色） */
  cursorAccent?: string
  /** 选中文本前景色 */
  selectionForeground?: string
  /** 选中文本背景色 */
  selectionBackground?: string
  /** 选中文本背景透明度 (0-1) */
  selectionInactiveBackground?: string
  /** 黑色 (ANSI 0) */
  black: string
  /** 红色 (ANSI 1) */
  red: string
  /** 绿色 (ANSI 2) */
  green: string
  /** 黄色 (ANSI 3) */
  yellow: string
  /** 蓝色 (ANSI 4) */
  blue: string
  /** 品红 (ANSI 5) */
  magenta: string
  /** 青色 (ANSI 6) */
  cyan: string
  /** 白色 (ANSI 7) */
  white: string
  /** 亮黑 (ANSI 8) */
  brightBlack: string
  /** 亮红 (ANSI 9) */
  brightRed: string
  /** 亮绿 (ANSI 10) */
  brightGreen: string
  /** 亮黄 (ANSI 11) */
  brightYellow: string
  /** 亮蓝 (ANSI 12) */
  brightBlue: string
  /** 亮品红 (ANSI 13) */
  brightMagenta: string
  /** 亮青 (ANSI 14) */
  brightCyan: string
  /** 亮白 (ANSI 15) */
  brightWhite: string
}

/**
 * 完整的终端主题定义
 */
export interface TerminalTheme {
  /** 主题名称（用于显示） */
  name: string
  /** 主题标识符 */
  id: TerminalThemeName
  /** 主题颜色配置 */
  colors: TerminalThemeColors
  /** 主题描述 */
  description?: string
}

/**
 * 主题状态
 */
export interface ThemeState {
  /** 当前应用主题 */
  appTheme: AppTheme
  /** 当前终端主题名称（null 表示跟随应用主题） */
  terminalTheme: TerminalThemeName | null
}

/**
 * 主题持久化数据
 */
export interface ThemePersistData {
  appThemeMode: AppThemeMode
  appTheme: AppTheme
  selectedTheme: ThemeName
  terminalTheme: TerminalThemeName | null
  version: number
}

/**
 * CSS 变量名称映射
 */
export type CSSVariableName = 
  | '--color-primary'
  | '--color-primary-hover'
  | '--color-primary-active'
  | '--color-bg-base'
  | '--color-bg-container'
  | '--color-bg-elevated'
  | '--color-bg-spotlight'
  | '--color-bg-mask'
  | '--color-text'
  | '--color-text-secondary'
  | '--color-text-tertiary'
  | '--color-text-quaternary'
  | '--color-border'
  | '--color-border-secondary'
  | '--color-success'
  | '--color-error'
  | '--color-warning'
  | '--color-info'
  | '--shadow-sm'
  | '--shadow-md'
  | '--shadow-lg'

/**
 * 亮色主题 CSS 变量值
 */
export type LightThemeVariables = Record<CSSVariableName, string>

/**
 * 暗色主题 CSS 变量值
 */
export type DarkThemeVariables = Record<CSSVariableName, string>