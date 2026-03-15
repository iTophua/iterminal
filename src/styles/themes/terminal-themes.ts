import type { TerminalTheme, TerminalThemeName, TerminalThemeColors } from '../../types/theme'

const classicDarkColors: TerminalThemeColors = {
  foreground: '#F8F8F2',
  background: '#1E1E1E',
  cursor: '#F8F8F2',
  cursorAccent: '#1E1E1E',
  selectionForeground: '#F8F8F2',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#1E1E1E',
  red: '#FF5555',
  green: '#50FA7B',
  yellow: '#F1FA8C',
  blue: '#BD93F9',
  magenta: '#FF79C6',
  cyan: '#8BE9FD',
  white: '#F8F8F2',
  brightBlack: '#6272A4',
  brightRed: '#FF6E6E',
  brightGreen: '#69FF94',
  brightYellow: '#FFFFA5',
  brightBlue: '#D6ACFF',
  brightMagenta: '#FF92DF',
  brightCyan: '#A4FFFF',
  brightWhite: '#FFFFFF',
}

const classicLightColors: TerminalThemeColors = {
  foreground: '#1E1E1E',
  background: '#FFFFFF',
  cursor: '#1E1E1E',
  cursorAccent: '#FFFFFF',
  selectionForeground: '#1E1E1E',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#1E1E1E',
  red: '#CD3131',
  green: '#00BC00',
  yellow: '#949800',
  blue: '#0451A5',
  magenta: '#BC05BC',
  cyan: '#0598BC',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#CD3131',
  brightGreen: '#14CE14',
  brightYellow: '#B5BA00',
  brightBlue: '#0451A5',
  brightMagenta: '#BC05BC',
  brightCyan: '#0598BC',
  brightWhite: '#A5A5A5',
}

const solarizedDarkColors: TerminalThemeColors = {
  foreground: '#839496',
  background: '#002B36',
  cursor: '#839496',
  cursorAccent: '#002B36',
  selectionForeground: '#839496',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#073642',
  red: '#DC322F',
  green: '#859900',
  yellow: '#B58900',
  blue: '#268BD2',
  magenta: '#D33682',
  cyan: '#2AA198',
  white: '#EEE8D5',
  brightBlack: '#002B36',
  brightRed: '#CB4B16',
  brightGreen: '#586E75',
  brightYellow: '#657B83',
  brightBlue: '#839496',
  brightMagenta: '#6C71C4',
  brightCyan: '#93A1A1',
  brightWhite: '#FDF6E3',
}

const solarizedLightColors: TerminalThemeColors = {
  foreground: '#657B83',
  background: '#FDF6E3',
  cursor: '#657B83',
  cursorAccent: '#FDF6E3',
  selectionForeground: '#657B83',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#073642',
  red: '#DC322F',
  green: '#859900',
  yellow: '#B58900',
  blue: '#268BD2',
  magenta: '#D33682',
  cyan: '#2AA198',
  white: '#EEE8D5',
  brightBlack: '#002B36',
  brightRed: '#CB4B16',
  brightGreen: '#586E75',
  brightYellow: '#657B83',
  brightBlue: '#839496',
  brightMagenta: '#6C71C4',
  brightCyan: '#93A1A1',
  brightWhite: '#FDF6E3',
}

const draculaColors: TerminalThemeColors = {
  foreground: '#F8F8F2',
  background: '#282A36',
  cursor: '#F8F8F2',
  cursorAccent: '#282A36',
  selectionForeground: '#F8F8F2',
  selectionBackground: 'rgba(68, 71, 90, 0.8)',
  black: '#21222C',
  red: '#FF5555',
  green: '#50FA7B',
  yellow: '#F1FA8C',
  blue: '#BD93F9',
  magenta: '#FF79C6',
  cyan: '#8BE9FD',
  white: '#F8F8F2',
  brightBlack: '#6272A4',
  brightRed: '#FF6E6E',
  brightGreen: '#69FF94',
  brightYellow: '#FFFFA5',
  brightBlue: '#D6ACFF',
  brightMagenta: '#FF92DF',
  brightCyan: '#A4FFFF',
  brightWhite: '#FFFFFF',
}

const oneDarkColors: TerminalThemeColors = {
  foreground: '#ABB2BF',
  background: '#282C34',
  cursor: '#528BFF',
  cursorAccent: '#282C34',
  selectionForeground: '#ABB2BF',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#282C34',
  red: '#E06C75',
  green: '#98C379',
  yellow: '#E5C07B',
  blue: '#61AFEF',
  magenta: '#C678DD',
  cyan: '#56B6C2',
  white: '#ABB2BF',
  brightBlack: '#5C6370',
  brightRed: '#E06C75',
  brightGreen: '#98C379',
  brightYellow: '#E5C07B',
  brightBlue: '#61AFEF',
  brightMagenta: '#C678DD',
  brightCyan: '#56B6C2',
  brightWhite: '#FFFFFF',
}

export const terminalThemes: Record<TerminalThemeName, TerminalTheme> = {
  'classic': {
    id: 'classic',
    name: 'Classic',
    colors: classicDarkColors,
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    colors: solarizedDarkColors,
  },
  'solarized-light': {
    id: 'solarized-light',
    name: 'Solarized Light',
    colors: solarizedLightColors,
  },
  'dracula': {
    id: 'dracula',
    name: 'Dracula',
    colors: draculaColors,
  },
  'one-dark': {
    id: 'one-dark',
    name: 'One Dark',
    colors: oneDarkColors,
  },
}

export const terminalThemesList = Object.values(terminalThemes)

export function getTerminalTheme(name: TerminalThemeName): TerminalTheme {
  return terminalThemes[name]
}

export function getThemeForAppTheme(appTheme: 'light' | 'dark'): TerminalThemeColors {
  return appTheme === 'dark' ? classicDarkColors : classicLightColors
}

export function resolveTerminalTheme(
  appTheme: 'light' | 'dark',
  terminalThemeOverride: TerminalThemeName | null
): TerminalThemeColors {
  if (terminalThemeOverride) {
    return terminalThemes[terminalThemeOverride].colors
  }
  return getThemeForAppTheme(appTheme)
}