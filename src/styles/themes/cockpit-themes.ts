import type { CockpitThemeName } from '../../stores/terminalStore'
import type { TerminalThemeColors, ThemeVariableSet } from '../../types/theme'
import type { ThemeDefinition } from './app-themes'

export interface CockpitTheme {
  id: CockpitThemeName
  name: string
  desc: string
  /** 主题色预览（弹层色板用） */
  swatch: string
  /** 注入驾驶舱根节点的 CSS 变量 */
  vars: Record<string, string>
  /** 驾驶舱内终端（xterm）调色板：驾驶舱主题直接驱动终端配色 */
  terminal: TerminalThemeColors
}

function termColors(base: {
  fg: string; bg: string; cursor: string; green: string; blue: string; amber: string; red: string
}): TerminalThemeColors {
  return {
    foreground: base.fg,
    background: base.bg,
    cursor: base.cursor,
    cursorAccent: base.bg,
    selectionBackground: base.green + '40',
    black: '#1A1D24',
    red: base.red,
    green: base.green,
    yellow: base.amber,
    blue: base.blue,
    magenta: '#C792EA',
    cyan: '#89DDFF',
    white: '#D5DAE2',
    brightBlack: '#5E6577',
    brightRed: '#FF7B86',
    brightGreen: base.green,
    brightYellow: '#FFD43B',
    brightBlue: '#82AAFF',
    brightMagenta: '#E2A6FF',
    brightCyan: '#A6E8FF',
    brightWhite: '#FFFFFF',
  }
}

/**
 * 驾驶舱布局专属主题：只作用于驾驶舱 chrome（主机墙/窗口/停靠栏/抽屉），
 * 终端区配色继续走全局终端主题。辉光/焦点色在 CSS 里用 color-mix 从 accent 派生。
 */
export const COCKPIT_THEMES: Record<CockpitThemeName, CockpitTheme> = {
  force: {
    id: 'force',
    name: '原力绿',
    desc: '终端绿 · 中性深黑（默认）',
    swatch: '#32D583',
    terminal: termColors({ fg: '#E8EAF0', bg: '#0B0D12', cursor: '#32D583', green: '#32D583', blue: '#4CC9E8', amber: '#F5B950', red: '#F4576C' }),
    vars: {
      '--ck-bg': '#0A0B0F',
      '--ck-canvas': '#07090C',
      '--ck-panel': '#0D0F14',
      '--ck-panel2': '#101218',
      '--ck-card': '#14161D',
      '--ck-card2': '#14181E',
      '--ck-accent': '#32D583',
      '--ck-accent-dim': '#06280F',
      '--ck-accent-tint': '#152A21',
      '--ck-accent-tint2': '#1B2A22',
      '--ck-glow1': 'rgba(50,213,131,.15)',
      '--ck-glow2': 'rgba(76,201,232,.07)',
      '--ck-term-bg': '#0B0D12',
      '--ck-win-bg': '#0C1014',
      '--ck-line': '#23262F',
      '--ck-line-soft': 'rgba(255,255,255,.08)',
      '--ck-t1': '#E8EAF0',
      '--ck-t2': '#9AA1B2',
      '--ck-t3': '#5E6577',
    },
  },
  aurora: {
    id: 'aurora',
    name: '极光',
    desc: '冰青 accent · 深蓝黑 · 双辉光',
    swatch: '#4CC9E8',
    terminal: termColors({ fg: '#E6EBF4', bg: '#080D14', cursor: '#4CC9E8', green: '#5BE9B0', blue: '#4CC9E8', amber: '#F5D76E', red: '#FF7B86' }),
    vars: {
      '--ck-bg': '#080C14',
      '--ck-canvas': '#050810',
      '--ck-panel': '#0B1018',
      '--ck-panel2': '#0E141E',
      '--ck-card': '#111826',
      '--ck-card2': '#131B2A',
      '--ck-accent': '#4CC9E8',
      '--ck-accent-dim': '#04202B',
      '--ck-accent-tint': '#12252E',
      '--ck-accent-tint2': '#152A35',
      '--ck-glow1': 'rgba(76,201,232,.17)',
      '--ck-glow2': 'rgba(99,110,255,.09)',
      '--ck-term-bg': '#080D14',
      '--ck-win-bg': '#0A0F16',
      '--ck-line': '#232B3A',
      '--ck-line-soft': 'rgba(140,180,255,.09)',
      '--ck-t1': '#E6EBF4',
      '--ck-t2': '#93A0B5',
      '--ck-t3': '#5A6679',
    },
  },
  ember: {
    id: 'ember',
    name: '余烬',
    desc: '琥珀橙 · 暖黑 · CRT 余温',
    swatch: '#FFA94D',
    terminal: termColors({ fg: '#F0EAE2', bg: '#100B08', cursor: '#FFA94D', green: '#A9C97B', blue: '#7FB4CA', amber: '#FFA94D', red: '#E06C5A' }),
    vars: {
      '--ck-bg': '#0F0B08',
      '--ck-canvas': '#0B0806',
      '--ck-panel': '#140F0B',
      '--ck-panel2': '#181210',
      '--ck-card': '#1C1611',
      '--ck-card2': '#201913',
      '--ck-accent': '#FFA94D',
      '--ck-accent-dim': '#2B1602',
      '--ck-accent-tint': '#2A1F12',
      '--ck-accent-tint2': '#2F2314',
      '--ck-glow1': 'rgba(255,169,77,.14)',
      '--ck-glow2': 'rgba(244,87,60,.07)',
      '--ck-term-bg': '#100B08',
      '--ck-win-bg': '#120D09',
      '--ck-line': '#2E251C',
      '--ck-line-soft': 'rgba(255,220,180,.09)',
      '--ck-t1': '#F0EAE2',
      '--ck-t2': '#A89C8D',
      '--ck-t3': '#6B6053',
    },
  },
}

export const COCKPIT_THEME_LIST = [COCKPIT_THEMES.force, COCKPIT_THEMES.aurora, COCKPIT_THEMES.ember]


/**
 * 驾驶舱主题 → 全局 --color-* 变量覆盖集。
 * 驾驶舱模式下叠加在应用主题之上（merge 覆盖），实现主页面/设置/面板全量换肤。
 */
export function cockpitColorOverrides(t: CockpitTheme): Partial<ThemeVariableSet> {
  const v = t.vars
  const accent = v['--ck-accent']
  return {
    '--color-bg-base': v['--ck-bg'],
    '--color-bg-container': v['--ck-panel'],
    '--color-bg-surface': v['--ck-panel'],
    '--color-bg-elevated': v['--ck-card'],
    '--color-bg-floating': v['--ck-card2'],
    '--color-bg-spotlight': `color-mix(in srgb, ${accent} 8%, transparent)`,
    '--color-border': v['--ck-line'],
    '--color-border-secondary': v['--ck-line-soft'],
    '--color-text': v['--ck-t1'],
    '--color-text-secondary': v['--ck-t2'],
    '--color-text-tertiary': v['--ck-t3'],
    '--color-text-quaternary': v['--ck-t3'],
    '--color-primary': accent,
    '--color-primary-subtle': `color-mix(in srgb, ${accent} 15%, transparent)`,
    '--color-primary-glow': `color-mix(in srgb, ${accent} 40%, transparent)`,
  } as Partial<ThemeVariableSet>
}

/**
 * 由应用主题 + 驾驶舱主题合成标准 ThemeDefinition，
 * 让 ThemeProvider 的整条管线（CSS 变量 / antd tokens / 窗口底色）零改造接入。
 * 驾驶舱为暗色系：light/dark 两套都输出暗色，material 沿用基础主题。
 */
export function buildCockpitThemeDefinition(t: CockpitTheme, base: ThemeDefinition): ThemeDefinition {
  const override = cockpitColorOverrides(t)
  const darkVars = { ...base.colors.dark, ...override } as ThemeVariableSet
  return {
    ...base,
    id: base.id,
    name: `${base.name} · 驾驶舱 ${t.name}`,
    colors: {
      light: darkVars,
      dark: darkVars,
    } as ThemeDefinition['colors'],
    antdPrimary: t.swatch,
    antdPrimaryHover: { light: t.swatch, dark: t.swatch },
    antdPrimaryActive: { light: t.swatch, dark: t.swatch },
  }
}

