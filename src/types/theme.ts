/**
 * 主题类型定义 v2
 * 采用 Design Token 架构：Primitive → Elevation → Semantic → Component
 */

// ============================================================================
// 基础类型
// ============================================================================

/** 应用主题模式 */
export type AppThemeMode = 'light' | 'dark' | 'system'

/** 解析后的应用主题（不含 system） */
export type AppTheme = 'light' | 'dark'

/** 应用配色主题名称 */
export type ThemeName = 'default' | 'matrix' | 'tokyo' | 'gruvbox' | 'nord' | 'catppuccin' | 'zen'

/** 终端预设主题名称 */
export type TerminalThemeName =
  | 'classic'
  | 'solarized-dark'
  | 'solarized-light'
  | 'dracula'
  | 'one-dark'
  | 'tokyo-night'
  | 'gruvbox-material'
  | 'rose-pine'
  | 'kanagawa'
  | 'everforest'

// ============================================================================
// Primitive Tokens - 基础原子值
// ============================================================================

/** 颜色板 - 每个主题的核心色阶 */
export interface ColorScale {
  50: string
  100: string
  200: string
  300: string
  400: string
  500: string
  600: string
  700: string
  800: string
  900: string
  950: string
}

/** 阴影刻度 - Material Design 风格双阴影 */
export interface ShadowScale {
  /** 无阴影 */
  none: string
  /** 极浅 - 内嵌元素 */
  xs: string
  /** 浅 - 小按钮、标签 */
  sm: string
  /** 中 - 卡片、输入框 */
  md: string
  /** 大 - 下拉菜单、浮动面板 */
  lg: string
  /** 极大 - 模态框、对话框 */
  xl: string
  /** 2x - 全屏覆盖层 */
  '2xl': string
}

/** 圆角刻度 */
export type RadiusScale = {
  none: string
  xs: string
  sm: string
  md: string
  lg: string
  xl: string
  '2xl': string
  full: string
}

/** 间距刻度 */
export type SpaceScale = {
  0: string
  1: string
  2: string
  3: string
  4: string
  5: string
  6: string
  8: string
  10: string
  12: string
  16: string
  20: string
  24: string
}

/** 字体刻度 */
export type FontScale = {
  xs: string
  sm: string
  base: string
  lg: string
  xl: string
  '2xl': string
}

// ============================================================================
// Elevation Tokens - 高度层级（核心创新）
// ============================================================================

/**
 * Material Design 风格的高度层级体系
 * 每一层都有明确的空间深度，通过 shadow + border + background 共同表达
 *
 * Level 0: base - 页面底层背景
 * Level 1: surface - 列表项、表格行、分割线区域
 * Level 2: container - 卡片、面板、内容区块
 * Level 3: elevated - 浮动工具栏、下拉菜单、选中状态
 * Level 4: floating - 右键菜单、tooltip、snackbar
 * Level 5: overlay - 模态框、drawer、全屏遮罩
 */
export interface ElevationTokens {
  /** Level 0 - 页面底层 */
  base: string
  /** Level 1 - 表面层 */
  surface: string
  /** Level 2 - 容器层 */
  container: string
  /** Level 3 - 抬高层 */
  elevated: string
  /** Level 4 - 浮动层 */
  floating: string
  /** Level 5 - 遮罩层 */
  overlay: string
}

/** 每个高度层级的装饰属性 */
export interface ElevationLevel {
  background: string
  shadow: string
  border: string
  /** 边框在 z 轴上的亮度偏移（亮色模式变暗，暗色模式变亮） */
  borderBrightness: number
}

// ============================================================================
// Semantic Tokens - 语义颜色
// ============================================================================

/** 品牌/主色语义 */
export interface BrandTokens {
  DEFAULT: string
  hover: string
  active: string
  muted: string
  subtle: string
  /** 用于文字发光、边框高亮 */
  glow: string
}

/** 功能色语义 */
export interface StatusTokens {
  success: string
  error: string
  warning: string
  info: string
}

/** 文字色语义 - 四层对比度体系 */
export interface TextTokens {
  /** 主文字 - 最高对比度 */
  primary: string
  /** 次要文字 - 中高对比度 */
  secondary: string
  /** 三级文字 - 中低对比度 */
  tertiary: string
  /** 四级文字/占位符 - 最低对比度 */
  quaternary: string
  /** 反色文字（用于深色按钮上） */
  inverse: string
  /** 链接文字 */
  link: string
  /** 链接悬停 */
  linkHover: string
}

/** 边框语义 */
export interface BorderTokens {
  DEFAULT: string
  secondary: string
  subtle: string
  /** 交互元素 hover 时的边框 */
  hover: string
  /** 交互元素 focus 时的边框 */
  focus: string
  /** 激活/选中状态的边框 */
  active: string
}

// ============================================================================
// State Tokens - 交互状态
// ============================================================================

/** 交互状态颜色 */
export interface StateTokens {
  /** hover 背景色（通常是 primary 的低透明度混合） */
  hoverBg: string
  /** hover 边框色 */
  hoverBorder: string
  /** active/pressed 背景色 */
  activeBg: string
  /** active/pressed 边框色 */
  activeBorder: string
  /** focus 外圈光环 */
  focusRing: string
  /** focus 阴影 */
  focusShadow: string
  /** disabled 背景色 */
  disabledBg: string
  /** disabled 文字色 */
  disabledText: string
  /** disabled 边框色 */
  disabledBorder: string
  /** selected 背景色 */
  selectedBg: string
  /** selected 边框色 */
  selectedBorder: string
  /** selected 文字色 */
  selectedText: string
}

// ============================================================================
// Component Tokens - 组件级 Token（可选，用于精细化控制）
// ============================================================================

export interface ComponentTokens {
  /** 按钮 */
  button: {
    primaryShadow: string
    defaultBg: string
    defaultHoverBg: string
    defaultActiveBg: string
  }
  /** 输入框 */
  input: {
    activeShadow: string
    placeholder: string
  }
  /** 卡片 */
  card: {
    boxShadow: string
    boxShadowHover: string
  }
  /** 模态框 */
  modal: {
    boxShadow: string
    maskBg: string
  }
  /** 菜单/下拉 */
  menu: {
    itemHoverBg: string
    itemSelectedBg: string
    itemActiveBg: string
  }
  /** 标签页 */
  tabs: {
    inkBar: string
    itemHoverColor: string
    itemActiveColor: string
  }
  /** 表格 */
  table: {
    headerBg: string
    rowHoverBg: string
    rowSelectedBg: string
    rowSelectedHoverBg: string
  }
}

// ============================================================================
// Theme Material - 主题材质属性
// ============================================================================

/** 主题材质描述，影响 CSS 生成策略 */
export interface ThemeMaterial {
  /** 材质名称 */
  name: 'glass' | 'crt' | 'deep-sea' | 'paper' | 'frost' | 'cream' | 'oled' | 'solid'
  /** 是否启用 backdrop-filter */
  useBackdropBlur: boolean
  /** 默认 blur 强度（px） */
  blurStrength: number
  /** 是否启用内发光效果 */
  useInnerGlow: boolean
  /** 是否启用扫描线/纹理 */
  useTexture: boolean
  /** 过渡动画曲线 */
  transitionEasing: string
  /** 过渡时长基准（ms） */
  transitionDuration: number
  /** 是否启用文字发光（如 matrix） */
  useTextGlow: boolean
  /** 文字发光强度 */
  textGlowStrength: number
}

// ============================================================================
// 完整的单主题变量集合（亮色或暗色模式）
// ============================================================================

export interface ThemeVariableSet {
  // Elevation
  '--color-bg-base': string
  '--color-bg-surface': string
  '--color-bg-container': string
  '--color-bg-elevated': string
  '--color-bg-floating': string
  '--color-bg-overlay': string
  '--color-bg-spotlight': string
  '--color-bg-mask': string

  // Brand
  '--color-primary': string
  '--color-primary-hover': string
  '--color-primary-active': string
  '--color-primary-muted': string
  '--color-primary-subtle': string
  '--color-primary-glow': string

  // Text
  '--color-text': string
  '--color-text-secondary': string
  '--color-text-tertiary': string
  '--color-text-quaternary': string
  '--color-text-inverse': string
  '--color-text-link': string
  '--color-text-link-hover': string

  // Border
  '--color-border': string
  '--color-border-secondary': string
  '--color-border-subtle': string
  '--color-border-hover': string
  '--color-border-focus': string
  '--color-border-active': string

  // Status
  '--color-success': string
  '--color-error': string
  '--color-warning': string
  '--color-info': string

  // State
  '--state-hover-bg': string
  '--state-hover-border': string
  '--state-active-bg': string
  '--state-active-border': string
  '--state-focus-ring': string
  '--state-focus-shadow': string
  '--state-disabled-bg': string
  '--state-disabled-text': string
  '--state-disabled-border': string
  '--state-selected-bg': string
  '--state-selected-border': string
  '--state-selected-text': string

  // Shadow
  '--shadow-none': string
  '--shadow-xs': string
  '--shadow-sm': string
  '--shadow-md': string
  '--shadow-lg': string
  '--shadow-xl': string
  '--shadow-2xl': string

  // Radius
  '--radius-none': string
  '--radius-xs': string
  '--radius-sm': string
  '--radius-md': string
  '--radius-lg': string
  '--radius-xl': string
  '--radius-2xl': string
  '--radius-full': string
}

// ============================================================================
// 终端主题（保持与 v1 兼容）
// ============================================================================

/** 终端主题颜色配置 - xterm.js theme 属性 */
export interface TerminalThemeColors {
  foreground: string
  background: string
  cursor: string
  cursorAccent?: string
  selectionForeground?: string
  selectionBackground?: string
  selectionInactiveBackground?: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** 完整的终端主题定义 */
export interface TerminalTheme {
  name: string
  id: TerminalThemeName
  colors: TerminalThemeColors
  description?: string
}

// ============================================================================
// 应用主题定义
// ============================================================================

export interface AppThemeDefinition {
  id: ThemeName
  name: string
  description: string
  material: ThemeMaterial
  /** Ant Design 主题主色 */
  antdPrimary: string
  antdPrimaryHover: Record<AppTheme, string>
  antdPrimaryActive: Record<AppTheme, string>
  colors: {
    light: ThemeVariableSet
    dark: ThemeVariableSet
  }
}

// ============================================================================
// 状态与持久化
// ============================================================================

export interface ThemeState {
  appTheme: AppTheme
  terminalTheme: TerminalThemeName | null
}

export interface ThemePersistData {
  appThemeMode: AppThemeMode
  appTheme: AppTheme
  selectedTheme: ThemeName
  terminalTheme: TerminalThemeName | null
  version: number
}

// ============================================================================
// CSS 变量名称映射（向后兼容 + 新变量）
// ============================================================================

export type CSSVariableName =
  // Elevation
  | '--color-bg-base'
  | '--color-bg-surface'
  | '--color-bg-container'
  | '--color-bg-elevated'
  | '--color-bg-floating'
  | '--color-bg-overlay'
  | '--color-bg-spotlight'
  | '--color-bg-mask'
  // Brand
  | '--color-primary'
  | '--color-primary-hover'
  | '--color-primary-active'
  | '--color-primary-muted'
  | '--color-primary-subtle'
  | '--color-primary-glow'
  // Text
  | '--color-text'
  | '--color-text-secondary'
  | '--color-text-tertiary'
  | '--color-text-quaternary'
  | '--color-text-inverse'
  | '--color-text-link'
  | '--color-text-link-hover'
  // Border
  | '--color-border'
  | '--color-border-secondary'
  | '--color-border-subtle'
  | '--color-border-hover'
  | '--color-border-focus'
  | '--color-border-active'
  // Status
  | '--color-success'
  | '--color-error'
  | '--color-warning'
  | '--color-info'
  // State
  | '--state-hover-bg'
  | '--state-hover-border'
  | '--state-active-bg'
  | '--state-active-border'
  | '--state-focus-ring'
  | '--state-focus-shadow'
  | '--state-disabled-bg'
  | '--state-disabled-text'
  | '--state-disabled-border'
  | '--state-selected-bg'
  | '--state-selected-border'
  | '--state-selected-text'
  // Shadow
  | '--shadow-none'
  | '--shadow-xs'
  | '--shadow-sm'
  | '--shadow-md'
  | '--shadow-lg'
  | '--shadow-xl'
  | '--shadow-2xl'
  // Radius
  | '--radius-none'
  | '--radius-xs'
  | '--radius-sm'
  | '--radius-md'
  | '--radius-lg'
  | '--radius-xl'
  | '--radius-2xl'
  | '--radius-full'

export type LightThemeVariables = Record<CSSVariableName, string>
export type DarkThemeVariables = Record<CSSVariableName, string>
