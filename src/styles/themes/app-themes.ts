import type { ThemeName, AppTheme, ThemeVariableSet, ThemeMaterial } from '../../types/theme'

export interface ThemeColorSet {
  light: ThemeVariableSet
  dark: ThemeVariableSet
}

export interface ThemeDefinition {
  id: ThemeName
  name: string
  description: string
  material: ThemeMaterial
  colors: ThemeColorSet
  antdPrimary: string
  antdPrimaryHover: Record<AppTheme, string>
  antdPrimaryActive: Record<AppTheme, string>
}

/**
 * 解析颜色字符串，支持 hex 和 rgba
 */
function parseColor(color: string): { r: number; g: number; b: number; alpha?: number } | null {
  const hex = color.trim()
  if (hex.startsWith('#')) {
    const clean = hex.replace('#', '')
    const bigint = parseInt(clean, 16)
    if (isNaN(bigint)) return null
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
  }
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
      alpha: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : undefined,
    }
  }
  return null
}

/**
 * 将颜色变亮或变暗
 * @param amount 正数变亮，负数变暗，范围 -1 ~ 1
 * @returns 保持原格式（hex 返回 hex，rgba 返回 rgba）
 */
function adjustColor(color: string, amount: number): string {
  const parsed = parseColor(color)
  if (!parsed) return color
  const { r, g, b, alpha } = parsed
  const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)))
  const rr = adjust(r).toString(16).padStart(2, '0')
  const gg = adjust(g).toString(16).padStart(2, '0')
  const bb = adjust(b).toString(16).padStart(2, '0')
  if (alpha !== undefined) {
    return `rgba(${adjust(r)}, ${adjust(g)}, ${adjust(b)}, ${alpha})`
  }
  return `#${rr}${gg}${bb}`
}

/**
 * 根据核心颜色生成完整的 ThemeVariableSet
 * 这是主题系统的核心辅助函数，确保所有派生值的一致性
 */
interface CoreColorConfig {
  primary: string
  primaryHover: string
  primaryActive: string
  bgBase: string
  bgContainer: string
  bgElevated: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  textQuaternary: string
  border: string
  borderSecondary: string
  success: string
  error: string
  warning: string
  info: string
  /** 是否为暗色模式，影响 shadow 和 state 计算方向 */
  isDark: boolean
  /** 主题色相，用于生成有色阴影 */
  themeHue: string
}

function buildThemeVariables(config: CoreColorConfig): ThemeVariableSet {
  const {
    primary,
    primaryHover,
    primaryActive,
    bgBase,
    bgContainer,
    bgElevated,
    textPrimary,
    textSecondary,
    textTertiary,
    textQuaternary,
    border,
    borderSecondary,
    success,
    error,
    warning,
    info,
    isDark,
    themeHue,
  } = config

  // 计算 surface（介于 base 和 container 之间）
  const surface = isDark
    ? adjustColor(bgBase, 0.03)
    : adjustColor(bgBase, -0.02)

  // 计算 floating（比 elevated 更亮/暗）
  const floating = isDark
    ? adjustColor(bgElevated, 0.04)
    : adjustColor(bgElevated, -0.03)

  // 计算 overlay（遮罩层背景）
  const overlay = isDark
    ? adjustColor(bgElevated, 0.06)
    : adjustColor(bgElevated, -0.04)

  // 阴影颜色 - 暗色模式下使用带主色色调的深灰，更精致；亮色使用主色色相
  const shadowColor = isDark ? themeHue : themeHue
  const shadowBaseOpacity = isDark ? 0.35 : 0.05
  // 环境阴影颜色（更柔和的漫反射）
  const ambientShadowColor = isDark ? '0, 0, 0' : themeHue
  const ambientOpacity = isDark ? 0.5 : 0.03

  // 状态色（基于 primary 的透明度混合）
  const primaryParsed = parseColor(primary)
  const primaryRgb = primaryParsed
    ? `${primaryParsed.r}, ${primaryParsed.g}, ${primaryParsed.b}`
    : '0, 0, 0'
  const hoverBg = isDark
    ? `rgba(${primaryRgb}, 0.12)`
    : `rgba(${primaryRgb}, 0.06)`
  const activeBg = isDark
    ? `rgba(${primaryRgb}, 0.18)`
    : `rgba(${primaryRgb}, 0.10)`
  const selectedBg = isDark
    ? `rgba(${primaryRgb}, 0.15)`
    : `rgba(${primaryRgb}, 0.08)`

  const disabledBg = isDark
    ? 'rgba(255, 255, 255, 0.04)'
    : 'rgba(0, 0, 0, 0.04)'
  const disabledText = isDark
    ? 'rgba(255, 255, 255, 0.25)'
    : 'rgba(0, 0, 0, 0.25)'
  const disabledBorder = isDark
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.08)'

  // focus ring 颜色
  const focusRing = `rgba(${primaryRgb}, 0.25)`
  const focusShadow = `0 0 0 3px rgba(${primaryRgb}, 0.15)`

  return {
    // Elevation
    '--color-bg-base': bgBase,
    '--color-bg-surface': surface,
    '--color-bg-container': bgContainer,
    '--color-bg-elevated': bgElevated,
    '--color-bg-floating': floating,
    '--color-bg-overlay': overlay,
    '--color-bg-spotlight': `rgba(${primaryRgb}, ${isDark ? 0.08 : 0.05})`,
    '--color-bg-mask': isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.45)',

    // Brand
    '--color-primary': primary,
    '--color-primary-hover': primaryHover,
    '--color-primary-active': primaryActive,
    '--color-primary-muted': isDark
      ? `rgba(${primaryRgb}, 0.6)`
      : adjustColor(primary, -0.15),
    '--color-primary-subtle': `rgba(${primaryRgb}, ${isDark ? 0.15 : 0.1})`,
    '--color-primary-glow': `rgba(${primaryRgb}, ${isDark ? 0.4 : 0.25})`,

    // Text
    '--color-text': textPrimary,
    '--color-text-secondary': textSecondary,
    '--color-text-tertiary': textTertiary,
    '--color-text-quaternary': textQuaternary,
    '--color-text-inverse': isDark ? '#000000' : '#ffffff',
    '--color-text-link': primary,
    '--color-text-link-hover': primaryHover,

    // Border
    '--color-border': border,
    '--color-border-secondary': borderSecondary,
    '--color-border-subtle': isDark
      ? adjustColor(border, 0.3)
      : adjustColor(border, 0.15),
    '--color-border-hover': primaryHover,
    '--color-border-focus': primary,
    '--color-border-active': primaryActive,

    // Status
    '--color-success': success,
    '--color-error': error,
    '--color-warning': warning,
    '--color-info': info,

    // State
    '--state-hover-bg': hoverBg,
    '--state-hover-border': `rgba(${primaryRgb}, 0.3)`,
    '--state-active-bg': activeBg,
    '--state-active-border': `rgba(${primaryRgb}, 0.45)`,
    '--state-focus-ring': focusRing,
    '--state-focus-shadow': focusShadow,
    '--state-disabled-bg': disabledBg,
    '--state-disabled-text': disabledText,
    '--state-disabled-border': disabledBorder,
    '--state-selected-bg': selectedBg,
    '--state-selected-border': primary,
    '--state-selected-text': primary,

    // Shadow - 三层阴影系统：环境光（柔和漫反射）+ 方向光（清晰投影）+ 边界光（微妙轮廓）
    '--shadow-none': 'none',
    // xs: 仅用于内嵌元素，几乎不可见
    '--shadow-xs': `0 1px 2px rgba(${ambientShadowColor}, ${ambientOpacity})`,
    // sm: 小按钮、标签 - 极浅的方向光
    '--shadow-sm': `0 1px 2px rgba(${shadowColor}, ${shadowBaseOpacity * 0.6}), 0 1px 3px rgba(${ambientShadowColor}, ${ambientOpacity})`,
    // md: 卡片、输入框 - 清晰的方向光 + 柔和环境光
    '--shadow-md': `0 4px 6px -1px rgba(${shadowColor}, ${shadowBaseOpacity}), 0 2px 4px -2px rgba(${ambientShadowColor}, ${ambientOpacity * 2})`,
    // lg: 下拉菜单、浮动面板 - 更强的抬升感
    '--shadow-lg': `0 10px 15px -3px rgba(${shadowColor}, ${shadowBaseOpacity * 1.1}), 0 4px 6px -4px rgba(${ambientShadowColor}, ${ambientOpacity * 2.5})`,
    // xl: 模态框、对话框 - 明显的悬浮感
    '--shadow-xl': `0 20px 25px -5px rgba(${shadowColor}, ${shadowBaseOpacity * 1.4}), 0 8px 10px -6px rgba(${ambientShadowColor}, ${ambientOpacity * 3})`,
    // 2xl: 全屏覆盖层 - 最大的深度感
    '--shadow-2xl': `0 25px 50px -12px rgba(${shadowColor}, ${shadowBaseOpacity * 1.8})`,
    // inner: 内阴影，用于内凹效果、输入框、卡片深度
    '--shadow-inner': `inset 0 1px 3px rgba(${ambientShadowColor}, ${ambientOpacity * 2.5})`,
    // inner-light: 微弱的内阴影，用于精细的层次区分
    '--shadow-inner-light': `inset 0 1px 1px rgba(${ambientShadowColor}, ${ambientOpacity})`,
    // glow: 外发光，用于 hover 状态、激活状态
    '--shadow-glow': `0 0 0 1px rgba(${primaryRgb}, ${isDark ? 0.15 : 0.08}), 0 0 20px rgba(${primaryRgb}, ${isDark ? 0.08 : 0.04})`,
    // glow-strong: 更强的发光，用于 focus 状态
    '--shadow-glow-strong': `0 0 0 2px rgba(${primaryRgb}, ${isDark ? 0.2 : 0.12}), 0 0 30px rgba(${primaryRgb}, ${isDark ? 0.1 : 0.06})`,

    // Radius
    '--radius-none': '0',
    '--radius-xs': '2px',
    '--radius-sm': '4px',
    '--radius-md': '6px',
    '--radius-lg': '8px',
    '--radius-xl': '12px',
    '--radius-2xl': '16px',
    '--radius-full': '9999px',
  }
}

// ============================================================================
// 主题材质定义
// ============================================================================

const materials: Record<ThemeName, ThemeMaterial> = {
  default: {
    name: 'glass',
    useBackdropBlur: true,
    blurStrength: 12,
    useInnerGlow: true,
    useTexture: false,
    transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDuration: 300,
    useTextGlow: false,
    textGlowStrength: 0,
  },
  matrix: {
    name: 'crt',
    useBackdropBlur: false,
    blurStrength: 0,
    useInnerGlow: true,
    useTexture: true,
    transitionEasing: 'cubic-bezier(0.4, 0, 1, 1)',
    transitionDuration: 150,
    useTextGlow: true,
    textGlowStrength: 0.6,
  },
  tokyo: {
    name: 'deep-sea',
    useBackdropBlur: true,
    blurStrength: 16,
    useInnerGlow: true,
    useTexture: false,
    transitionEasing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    transitionDuration: 350,
    useTextGlow: false,
    textGlowStrength: 0.2,
  },
  gruvbox: {
    name: 'paper',
    useBackdropBlur: false,
    blurStrength: 0,
    useInnerGlow: false,
    useTexture: false,
    transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDuration: 250,
    useTextGlow: false,
    textGlowStrength: 0,
  },
  nord: {
    name: 'frost',
    useBackdropBlur: true,
    blurStrength: 20,
    useInnerGlow: true,
    useTexture: false,
    transitionEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    transitionDuration: 400,
    useTextGlow: false,
    textGlowStrength: 0.15,
  },
  catppuccin: {
    name: 'cream',
    useBackdropBlur: true,
    blurStrength: 14,
    useInnerGlow: true,
    useTexture: false,
    transitionEasing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    transitionDuration: 350,
    useTextGlow: false,
    textGlowStrength: 0.1,
  },
  zen: {
    name: 'oled',
    useBackdropBlur: true,
    blurStrength: 16,
    useInnerGlow: false,
    useTexture: false,
    transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDuration: 200,
    useTextGlow: false,
    textGlowStrength: 0.08,
  },
}

// ============================================================================
// 主题定义
// ============================================================================

export const themes: Record<ThemeName, ThemeDefinition> = {
  default: {
    id: 'default',
    name: '默认',
    description: '清新绿意，现代玻璃质感',
    material: materials.default,
    antdPrimary: '#00b96b',
    antdPrimaryHover: { light: '#00a35e', dark: '#1cc77a' },
    antdPrimaryActive: { light: '#008f51', dark: '#33d489' },
    colors: {
      light: buildThemeVariables({
        primary: '#00b96b',
        primaryHover: '#00a35e',
        primaryActive: '#008f51',
        bgBase: '#f8faf9',
        bgContainer: '#ffffff',
        bgElevated: '#f0f5f2',
        textPrimary: 'rgba(0, 0, 0, 0.88)',
        textSecondary: 'rgba(0, 0, 0, 0.72)',
        textTertiary: 'rgba(0, 0, 0, 0.52)',
        textQuaternary: 'rgba(0, 0, 0, 0.30)',
        border: 'rgba(0, 0, 0, 0.12)',
        borderSecondary: 'rgba(0, 0, 0, 0.06)',
        success: '#52c41a',
        error: '#ff4d4f',
        warning: '#faad14',
        info: '#1677ff',
        isDark: false,
        themeHue: '0, 185, 107',
      }),
      dark: buildThemeVariables({
        primary: '#00b96b',
        primaryHover: '#1cc77a',
        primaryActive: '#33d489',
        bgBase: '#0d1110',
        bgContainer: '#141a18',
        bgElevated: '#1c2421',
        textPrimary: 'rgba(255, 255, 255, 0.88)',
        textSecondary: 'rgba(255, 255, 255, 0.65)',
        textTertiary: 'rgba(255, 255, 255, 0.45)',
        textQuaternary: 'rgba(255, 255, 255, 0.25)',
        border: 'rgba(255, 255, 255, 0.12)',
        borderSecondary: 'rgba(255, 255, 255, 0.06)',
        success: '#52c41a',
        error: '#ff4d4f',
        warning: '#faad14',
        info: '#1677ff',
        isDark: true,
        themeHue: '0, 185, 107',
      }),
    },
  },

  matrix: {
    id: 'matrix',
    name: '矩阵',
    description: 'CRT 磷光绿，黑客帝国经典',
    material: materials.matrix,
    antdPrimary: '#00FF41',
    antdPrimaryHover: { light: '#00CC33', dark: '#39FF14' },
    antdPrimaryActive: { light: '#009922', dark: '#66FF40' },
    colors: {
      light: buildThemeVariables({
        primary: '#00B32D',
        primaryHover: '#009922',
        primaryActive: '#007718',
        bgBase: '#F0FFF0',
        bgContainer: '#FAFFFA',
        bgElevated: '#E8FFE8',
        textPrimary: '#0A1A0A',
        textSecondary: '#1A3A1A',
        textTertiary: '#2A5A2A',
        textQuaternary: '#3A6A3A',
        border: 'rgba(0, 200, 50, 0.18)',
        borderSecondary: 'rgba(0, 200, 50, 0.06)',
        success: '#00CC33',
        error: '#FF3333',
        warning: '#DDAA00',
        info: '#00AA55',
        isDark: false,
        themeHue: '0, 255, 65',
      }),
      dark: buildThemeVariables({
        primary: '#00FF41',
        primaryHover: '#39FF14',
        primaryActive: '#66FF40',
        bgBase: '#000500',
        bgContainer: '#030803',
        bgElevated: '#0A120A',
        textPrimary: '#C0FFC8',
        textSecondary: '#80CC88',
        textTertiary: '#508855',
        textQuaternary: '#305533',
        border: 'rgba(0, 255, 65, 0.15)',
        borderSecondary: 'rgba(0, 255, 65, 0.05)',
        success: '#39FF14',
        error: '#FF4444',
        warning: '#FFCC00',
        info: '#00EE77',
        isDark: true,
        themeHue: '0, 255, 65',
      }),
    },
  },

  tokyo: {
    id: 'tokyo',
    name: '东京夜',
    description: '深邃靛蓝，极光般静谧',
    material: materials.tokyo,
    antdPrimary: '#7aa2f7',
    antdPrimaryHover: { light: '#5a7fe0', dark: '#9dbaf7' },
    antdPrimaryActive: { light: '#3a60c8', dark: '#c0d3fc' },
    colors: {
      light: buildThemeVariables({
        primary: '#5365cc',
        primaryHover: '#3a50bb',
        primaryActive: '#283ba0',
        bgBase: '#edf0fa',
        bgContainer: '#ffffff',
        bgElevated: '#e4e8f7',
        textPrimary: '#1a1b35',
        textSecondary: '#303050',
        textTertiary: '#505070',
        textQuaternary: '#707090',
        border: 'rgba(83, 101, 204, 0.15)',
        borderSecondary: 'rgba(83, 101, 204, 0.06)',
        success: '#9ece6a',
        error: '#f7768e',
        warning: '#e0af68',
        info: '#7aa2f7',
        isDark: false,
        themeHue: '122, 162, 247',
      }),
      dark: buildThemeVariables({
        primary: '#7aa2f7',
        primaryHover: '#9dbaf7',
        primaryActive: '#c0d3fc',
        bgBase: '#12131c',
        bgContainer: '#1a1b26',
        bgElevated: '#25263f',
        textPrimary: '#c0caf5',
        textSecondary: '#a9b1d6',
        textTertiary: '#565f89',
        textQuaternary: '#3b4261',
        border: 'rgba(122, 162, 247, 0.12)',
        borderSecondary: 'rgba(122, 162, 247, 0.05)',
        success: '#9ece6a',
        error: '#f7768e',
        warning: '#e0af68',
        info: '#7dcfff',
        isDark: true,
        themeHue: '122, 162, 247',
      }),
    },
  },

  gruvbox: {
    id: 'gruvbox',
    name: '复古盒',
    description: '怀旧暖调，老派黑客风',
    material: materials.gruvbox,
    antdPrimary: '#fe8019',
    antdPrimaryHover: { light: '#d06a10', dark: '#fe9a3d' },
    antdPrimaryActive: { light: '#a8520a', dark: '#ffb44d' },
    colors: {
      light: buildThemeVariables({
        primary: '#cc6a18',
        primaryHover: '#a85510',
        primaryActive: '#844108',
        bgBase: '#fdf6e3',
        bgContainer: '#fffbf0',
        bgElevated: '#f5edd5',
        textPrimary: '#3c3836',
        textSecondary: '#504945',
        textTertiary: '#665c54',
        textQuaternary: '#7c6f64',
        border: 'rgba(204, 106, 24, 0.18)',
        borderSecondary: 'rgba(204, 106, 24, 0.06)',
        success: '#98971a',
        error: '#cc241d',
        warning: '#d79921',
        info: '#458588',
        isDark: false,
        themeHue: '254, 128, 25',
      }),
      dark: buildThemeVariables({
        primary: '#fe8019',
        primaryHover: '#fe9a3d',
        primaryActive: '#ffb44d',
        bgBase: '#1d2021',
        bgContainer: '#282828',
        bgElevated: '#32302f',
        textPrimary: '#ebdbb2',
        textSecondary: '#d5c4a1',
        textTertiary: '#928374',
        textQuaternary: '#665c54',
        border: 'rgba(254, 128, 25, 0.12)',
        borderSecondary: 'rgba(254, 128, 25, 0.05)',
        success: '#b8bb26',
        error: '#fb4934',
        warning: '#fabd2f',
        info: '#83a598',
        isDark: true,
        themeHue: '254, 128, 25',
      }),
    },
  },

  nord: {
    id: 'nord',
    name: 'Nord',
    description: '北极冷色调，斯堪的纳维亚极简',
    material: materials.nord,
    antdPrimary: '#88c0d0',
    antdPrimaryHover: { light: '#6bb3c5', dark: '#a0d0e0' },
    antdPrimaryActive: { light: '#5a9ab0', dark: '#b8e0f0' },
    colors: {
      light: buildThemeVariables({
        primary: '#5e81ac',
        primaryHover: '#4a6d99',
        primaryActive: '#3a5a88',
        bgBase: '#eceff4',
        bgContainer: '#ffffff',
        bgElevated: '#e5e9f0',
        textPrimary: '#2e3440',
        textSecondary: '#3b4252',
        textTertiary: '#4c566a',
        textQuaternary: '#6a7485',
        border: 'rgba(94, 129, 172, 0.18)',
        borderSecondary: 'rgba(94, 129, 172, 0.06)',
        success: '#a3be8c',
        error: '#bf616a',
        warning: '#ebcb8b',
        info: '#81a1c1',
        isDark: false,
        themeHue: '136, 192, 208',
      }),
      dark: buildThemeVariables({
        primary: '#88c0d0',
        primaryHover: '#8fbcbb',
        primaryActive: '#a0d0e0',
        bgBase: '#242933',
        bgContainer: '#2e3440',
        bgElevated: '#3b4252',
        textPrimary: '#eceff4',
        textSecondary: '#d8dee9',
        textTertiary: '#7b88a1',
        textQuaternary: '#4c566a',
        border: 'rgba(136, 192, 208, 0.12)',
        borderSecondary: 'rgba(136, 192, 208, 0.05)',
        success: '#a3be8c',
        error: '#bf616a',
        warning: '#ebcb8b',
        info: '#81a1c1',
        isDark: true,
        themeHue: '136, 192, 208',
      }),
    },
  },

  catppuccin: {
    id: 'catppuccin',
    name: 'Catppuccin',
    description: '柔暖 pastel 色调，社区最爱',
    material: materials.catppuccin,
    antdPrimary: '#cba6f7',
    antdPrimaryHover: { light: '#b88ef5', dark: '#ddb6f7' },
    antdPrimaryActive: { light: '#a070e0', dark: '#e8c8f8' },
    colors: {
      light: buildThemeVariables({
        primary: '#8839ef',
        primaryHover: '#7a2bd9',
        primaryActive: '#6a1fc0',
        bgBase: '#f0f1f5',
        bgContainer: '#ffffff',
        bgElevated: '#e6e9ef',
        textPrimary: '#4c4f69',
        textSecondary: '#5c5f77',
        textTertiary: '#6c6f85',
        textQuaternary: '#7c7f93',
        border: 'rgba(136, 57, 239, 0.15)',
        borderSecondary: 'rgba(136, 57, 239, 0.06)',
        success: '#40a02b',
        error: '#d20f39',
        warning: '#df8e1d',
        info: '#1e66f5',
        isDark: false,
        themeHue: '203, 166, 247',
      }),
      dark: buildThemeVariables({
        primary: '#cba6f7',
        primaryHover: '#ddb6f7',
        primaryActive: '#e8c8f8',
        bgBase: '#181825',
        bgContainer: '#1e1e2e',
        bgElevated: '#313244',
        textPrimary: '#cdd6f4',
        textSecondary: '#bac2de',
        textTertiary: '#6c7086',
        textQuaternary: '#45475a',
        border: 'rgba(203, 166, 247, 0.12)',
        borderSecondary: 'rgba(203, 166, 247, 0.05)',
        success: '#a6e3a1',
        error: '#f38ba8',
        warning: '#f9e2af',
        info: '#89b4fa',
        isDark: true,
        themeHue: '203, 166, 247',
      }),
    },
  },

  zen: {
    id: 'zen',
    name: '极简',
    description: '高级灰白与 OLED 纯黑，极简克制之美',
    material: materials.zen,
    antdPrimary: '#374151',
    antdPrimaryHover: { light: '#6b7280', dark: '#d1d5db' },
    antdPrimaryActive: { light: '#4b5563', dark: '#e5e7eb' },
    colors: {
      light: buildThemeVariables({
        primary: '#374151',
        primaryHover: '#4b5563',
        primaryActive: '#1f2937',
        bgBase: '#f7f7f8',
        bgContainer: '#ffffff',
        bgElevated: '#f3f4f6',
        textPrimary: 'rgba(17, 24, 39, 0.90)',
        textSecondary: 'rgba(17, 24, 39, 0.68)',
        textTertiary: 'rgba(17, 24, 39, 0.48)',
        textQuaternary: 'rgba(17, 24, 39, 0.28)',
        border: 'rgba(0, 0, 0, 0.06)',
        borderSecondary: 'rgba(0, 0, 0, 0.03)',
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#6b7280',
        isDark: false,
        themeHue: '55, 65, 81',
      }),
      dark: buildThemeVariables({
        primary: '#9ca3af',
        primaryHover: '#d1d5db',
        primaryActive: '#e5e7eb',
        bgBase: '#000000',
        bgContainer: '#0a0a0a',
        bgElevated: '#111111',
        textPrimary: 'rgba(255, 255, 255, 0.92)',
        textSecondary: 'rgba(255, 255, 255, 0.60)',
        textTertiary: 'rgba(255, 255, 255, 0.38)',
        textQuaternary: 'rgba(255, 255, 255, 0.20)',
        border: 'rgba(255, 255, 255, 0.06)',
        borderSecondary: 'rgba(255, 255, 255, 0.03)',
        success: '#34d399',
        error: '#f87171',
        warning: '#fbbf24',
        info: '#9ca3af',
        isDark: true,
        themeHue: '156, 163, 175',
      }),
    },
  },
}

export const themeList = Object.values(themes)

export function getThemeColors(themeName: ThemeName, mode: AppTheme): ThemeVariableSet {
  return themes[themeName].colors[mode]
}

export function getThemeMaterial(themeName: ThemeName): ThemeMaterial {
  return themes[themeName].material
}
