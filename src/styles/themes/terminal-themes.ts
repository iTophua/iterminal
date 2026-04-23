import type { TerminalTheme, TerminalThemeName, TerminalThemeColors } from '../../types/theme'
import type { ThemeName, AppTheme } from '../../types/theme'

const classicDarkColors: TerminalThemeColors = {
  foreground: '#F8F8F2',
  background: '#1E1E1E',
  cursor: '#F8F8F2',
  cursorAccent: '#1E1E1E',
  selectionForeground: '#F8F8F2',
  selectionBackground: 'rgba(107, 189, 107, 0.3)',
  black: '#1E1E1E', red: '#FF5555', green: '#50FA7B', yellow: '#F1FA8C',
  blue: '#BD93F9', magenta: '#FF79C6', cyan: '#8BE9FD', white: '#F8F8F2',
  brightBlack: '#6272A4', brightRed: '#FF6E6E', brightGreen: '#69FF94',
  brightYellow: '#FFFFA5', brightBlue: '#D6ACFF', brightMagenta: '#FF92DF',
  brightCyan: '#A4FFFF', brightWhite: '#FFFFFF',
}

const classicLightColors: TerminalThemeColors = {
  foreground: '#1E1E1E',
  background: '#FFFFFF',
  cursor: '#1E1E1E',
  cursorAccent: '#FFFFFF',
  selectionForeground: '#1E1E1E',
  selectionBackground: 'rgba(0, 120, 0, 0.15)',
  black: '#1E1E1E', red: '#CD3131', green: '#00BC00', yellow: '#949800',
  blue: '#0451A5', magenta: '#BC05BC', cyan: '#0598BC', white: '#555555',
  brightBlack: '#666666', brightRed: '#CD3131', brightGreen: '#14CE14',
  brightYellow: '#B5BA00', brightBlue: '#0451A5', brightMagenta: '#BC05BC',
  brightCyan: '#0598BC', brightWhite: '#A5A5A5',
}

const solarizedDarkColors: TerminalThemeColors = {
  foreground: '#839496', background: '#002B36', cursor: '#839496',
  cursorAccent: '#002B36', selectionForeground: '#839496',
  selectionBackground: 'rgba(38, 139, 210, 0.25)',
  black: '#073642', red: '#DC322F', green: '#859900', yellow: '#B58900',
  blue: '#268BD2', magenta: '#D33682', cyan: '#2AA198', white: '#EEE8D5',
  brightBlack: '#002B36', brightRed: '#CB4B16', brightGreen: '#586E75',
  brightYellow: '#657B83', brightBlue: '#839496', brightMagenta: '#6C71C4',
  brightCyan: '#93A1A1', brightWhite: '#FDF6E3',
}

const solarizedLightColors: TerminalThemeColors = {
  foreground: '#657B83', background: '#FDF6E3', cursor: '#657B83',
  cursorAccent: '#FDF6E3', selectionForeground: '#657B83',
  selectionBackground: 'rgba(38, 139, 210, 0.18)',
  black: '#073642', red: '#DC322F', green: '#859900', yellow: '#B58900',
  blue: '#268BD2', magenta: '#D33682', cyan: '#2AA198', white: '#EEE8D5',
  brightBlack: '#002B36', brightRed: '#CB4B16', brightGreen: '#586E75',
  brightYellow: '#657B83', brightBlue: '#839496', brightMagenta: '#6C71C4',
  brightCyan: '#93A1A1', brightWhite: '#FDF6E3',
}

const draculaColors: TerminalThemeColors = {
  foreground: '#F8F8F2', background: '#282A36', cursor: '#F8F8F2',
  cursorAccent: '#282A36', selectionForeground: '#F8F8F2',
  selectionBackground: 'rgba(68, 71, 90, 0.8)',
  black: '#21222C', red: '#FF5555', green: '#50FA7B', yellow: '#F1FA8C',
  blue: '#BD93F9', magenta: '#FF79C6', cyan: '#8BE9FD', white: '#F8F8F2',
  brightBlack: '#6272A4', brightRed: '#FF6E6E', brightGreen: '#69FF94',
  brightYellow: '#FFFFA5', brightBlue: '#D6ACFF', brightMagenta: '#FF92DF',
  brightCyan: '#A4FFFF', brightWhite: '#FFFFFF',
}

const oneDarkColors: TerminalThemeColors = {
  foreground: '#ABB2BF', background: '#282C34', cursor: '#528BFF',
  cursorAccent: '#282C34', selectionForeground: '#ABB2BF',
  selectionBackground: 'rgba(97, 175, 239, 0.25)',
  black: '#282C34', red: '#E06C75', green: '#98C379', yellow: '#E5C07B',
  blue: '#61AFEF', magenta: '#C678DD', cyan: '#56B6C2', white: '#ABB2BF',
  brightBlack: '#5C6370', brightRed: '#E06C75', brightGreen: '#98C379',
  brightYellow: '#E5C07B', brightBlue: '#61AFEF', brightMagenta: '#C678DD',
  brightCyan: '#56B6C2', brightWhite: '#FFFFFF',
}

const tokyoNightColors: TerminalThemeColors = {
  foreground: '#C0CAF5', background: '#1A1B26', cursor: '#7AA2F7',
  cursorAccent: '#1A1B26', selectionForeground: '#C0CAF5',
  selectionBackground: 'rgba(122, 162, 247, 0.25)',
  black: '#15161E', red: '#F7768E', green: '#9ECE6A', yellow: '#E0AF68',
  blue: '#7AA2F7', magenta: '#BB9AF7', cyan: '#7DCFFF', white: '#A9B1D6',
  brightBlack: '#414868', brightRed: '#F7768E', brightGreen: '#9ECE6A',
  brightYellow: '#E0AF68', brightBlue: '#7AA2F7', brightMagenta: '#BB9AF7',
  brightCyan: '#7DCFFF', brightWhite: '#C0CAF5',
}

const gruvboxMaterialColors: TerminalThemeColors = {
  foreground: '#D4BE98', background: '#282828', cursor: '#A89984',
  cursorAccent: '#282828', selectionForeground: '#D4BE98',
  selectionBackground: 'rgba(168, 153, 132, 0.25)',
  black: '#282828', red: '#EA6962', green: '#A9B665', yellow: '#D8A657',
  blue: '#7DAEA3', magenta: '#D3869B', cyan: '#89B482', white: '#D4BE98',
  brightBlack: '#928374', brightRed: '#EA6962', brightGreen: '#A9B665',
  brightYellow: '#D8A657', brightBlue: '#7DAEA3', brightMagenta: '#D3869B',
  brightCyan: '#89B482', brightWhite: '#EBDBB2',
}

const rosePineColors: TerminalThemeColors = {
  foreground: '#E0DEF4', background: '#191724', cursor: '#EBBCBA',
  cursorAccent: '#191724', selectionForeground: '#E0DEF4',
  selectionBackground: 'rgba(235, 188, 186, 0.25)',
  black: '#26233A', red: '#EB6F92', green: '#31748F', yellow: '#F6C177',
  blue: '#9CCFD8', magenta: '#C4A7E7', cyan: '#EBBCBA', white: '#E0DEF4',
  brightBlack: '#6E6A86', brightRed: '#EB6F92', brightGreen: '#31748F',
  brightYellow: '#F6C177', brightBlue: '#9CCFD8', brightMagenta: '#C4A7E7',
  brightCyan: '#EBBCBA', brightWhite: '#FFFAF3',
}

const kanagawaColors: TerminalThemeColors = {
  foreground: '#DCD7BA', background: '#1F1F28', cursor: '#C8C093',
  cursorAccent: '#1F1F28', selectionForeground: '#DCD7BA',
  selectionBackground: 'rgba(200, 192, 147, 0.25)',
  black: '#090618', red: '#C34043', green: '#76946A', yellow: '#C0A36E',
  blue: '#7E9CD8', magenta: '#957FB8', cyan: '#6A9589', white: '#C8C093',
  brightBlack: '#727169', brightRed: '#E82424', brightGreen: '#98BB6C',
  brightYellow: '#E6C384', brightBlue: '#7FB4CA', brightMagenta: '#938AA9',
  brightCyan: '#7AA89F', brightWhite: '#DCD7BA',
}

const everforestColors: TerminalThemeColors = {
  foreground: '#D3C6AA', background: '#2B3339', cursor: '#A7C080',
  cursorAccent: '#2B3339', selectionForeground: '#D3C6AA',
  selectionBackground: 'rgba(167, 192, 128, 0.25)',
  black: '#374145', red: '#E67E80', green: '#A7C080', yellow: '#DBBC7F',
  blue: '#7FBBB3', magenta: '#D699B6', cyan: '#83C092', white: '#D3C6AA',
  brightBlack: '#4F585E', brightRed: '#E67E80', brightGreen: '#A7C080',
  brightYellow: '#DBBC7F', brightBlue: '#7FBBB3', brightMagenta: '#D699B6',
  brightCyan: '#83C092', brightWhite: '#D3C6AA',
}

export const terminalThemes: Record<TerminalThemeName, TerminalTheme> = {
  'classic': { id: 'classic', name: 'Classic', description: '经典暗色终端风格', colors: classicDarkColors },
  'solarized-dark': { id: 'solarized-dark', name: 'Solarized Dark', description: 'Solarized 深色主题，低对比度护眼', colors: solarizedDarkColors },
  'solarized-light': { id: 'solarized-light', name: 'Solarized Light', description: 'Solarized 浅色主题，明亮柔和', colors: solarizedLightColors },
  'dracula': { id: 'dracula', name: 'Dracula', description: 'Dracula 暗色主题，紫色调高对比', colors: draculaColors },
  'one-dark': { id: 'one-dark', name: 'One Dark', description: 'Atom One Dark 风格，开发者最爱', colors: oneDarkColors },
  'tokyo-night': { id: 'tokyo-night', name: 'Tokyo Night', description: '东京夜配色，深邃靛蓝极光', colors: tokyoNightColors },
  'gruvbox-material': { id: 'gruvbox-material', name: 'Gruvbox Material', description: 'Gruvbox 现代变体，更饱和更温暖', colors: gruvboxMaterialColors },
  'rose-pine': { id: 'rose-pine', name: 'Rosé Pine', description: '优雅紫粉调，自然与科技的融合', colors: rosePineColors },
  'kanagawa': { id: 'kanagawa', name: 'Kanagawa', description: '浮世绘灵感，深靛与金', colors: kanagawaColors },
  'everforest': { id: 'everforest', name: 'Everforest', description: '森林自然调，柔和护眼', colors: everforestColors },
}

export const terminalThemesList = Object.values(terminalThemes)

interface AppThemeTerminalPair {
  dark: TerminalThemeColors
  light: TerminalThemeColors
}

const appThemeTerminalMap: Record<ThemeName, AppThemeTerminalPair> = {
  default: {
    dark: {
      foreground: '#E0FFE0', background: '#0A120A', cursor: '#00FF41',
      cursorAccent: '#0A120A', selectionForeground: '#00FF41',
      selectionBackground: 'rgba(0, 255, 65, 0.25)',
      black: '#0A120A', red: '#FF3333', green: '#00FF41', yellow: '#FFCC00',
      blue: '#00B3FF', magenta: '#FF00AA', cyan: '#00DDDD', white: '#C0FFC8',
      brightBlack: '#305533', brightRed: '#FF6666', brightGreen: '#66FF66',
      brightYellow: '#FFEE44', brightBlue: '#44CCFF', brightMagenta: '#FF44BB',
      brightCyan: '#44EEEE', brightWhite: '#E0FFE0',
    },
    light: {
      foreground: '#0A1A0A', background: '#FAFFFA', cursor: '#00B32D',
      cursorAccent: '#FAFFFA', selectionForeground: '#0A1A0A',
      selectionBackground: 'rgba(0, 179, 45, 0.25)',
      black: '#1A3A1A', red: '#CC2222', green: '#009922', yellow: '#AA8800',
      blue: '#0066CC', magenta: '#AA0077', cyan: '#009999', white: '#555555',
      brightBlack: '#3A6A3A', brightRed: '#EE4444', brightGreen: '#22BB22',
      brightYellow: '#CCAA22', brightBlue: '#2288EE', brightMagenta: '#CC2288',
      brightCyan: '#22BBBB', brightWhite: '#888888',
    },
  },
  matrix: {
    dark: {
      foreground: '#00FF41', background: '#000000', cursor: '#00FF41',
      cursorAccent: '#000000', selectionForeground: '#000000',
      selectionBackground: 'rgba(0, 255, 65, 0.35)',
      black: '#000000', red: '#FF2020', green: '#00FF41', yellow: '#FFFF00',
      blue: '#0080FF', magenta: '#FF0080', cyan: '#00FFFF', white: '#C0FFC8',
      brightBlack: '#002200', brightRed: '#FF5555', brightGreen: '#55FF55',
      brightYellow: '#FFFF55', brightBlue: '#5599FF', brightMagenta: '#FF55AA',
      brightCyan: '#55FFFF', brightWhite: '#E0FFE0',
    },
    light: {
      foreground: '#002200', background: '#F0FFF0', cursor: '#00B32D',
      cursorAccent: '#F0FFF0', selectionForeground: '#002200',
      selectionBackground: 'rgba(0, 179, 45, 0.20)',
      black: '#001800', red: '#CC1111', green: '#008811', yellow: '#888800',
      blue: '#0055AA', magenta: '#AA0055', cyan: '#008888', white: '#555533',
      brightBlack: '#224422', brightRed: '#DD3333', brightGreen: '#33BB33',
      brightYellow: '#BBBB33', brightBlue: '#3388DD', brightMagenta: '#DD3388',
      brightCyan: '#33BBBB', brightWhite: '#88AA88',
    },
  },
  tokyo: {
    dark: {
      foreground: '#C0CAF5', background: '#1A1B26', cursor: '#7AA2F7',
      cursorAccent: '#1A1B26', selectionForeground: '#C0CAF5',
      selectionBackground: 'rgba(122, 162, 247, 0.20)',
      black: '#15161E', red: '#F7768E', green: '#9ECE6A', yellow: '#E0AF68',
      blue: '#7AA2F7', magenta: '#BB9AF7', cyan: '#7DCFFF', white: '#A9B1D6',
      brightBlack: '#414868', brightRed: '#F7768E', brightGreen: '#9ECE6A',
      brightYellow: '#E0AF68', brightBlue: '#7AA2F7', brightMagenta: '#BB9AF7',
      brightCyan: '#7DCFFF', brightWhite: '#C0CAF5',
    },
    light: {
      foreground: '#1A1B35', background: '#FFFFFF', cursor: '#5365CC',
      cursorAccent: '#FFFFFF', selectionForeground: '#1A1B35',
      selectionBackground: 'rgba(83, 101, 204, 0.12)',
      black: '#1A1B35', red: '#D9485A', green: '#6B9B37', yellow: '#C48A2A',
      blue: '#5365CC', magenta: '#8B63C4', cyan: '#3A8FB7', white: '#555566',
      brightBlack: '#3A4060', brightRed: '#E06072', brightGreen: '#80BD47',
      brightYellow: '#D9A238', brightBlue: '#6B82E0', brightMagenta: '#A280DB',
      brightCyan: '#4BA3CD', brightWhite: '#888899',
    },
  },
  gruvbox: {
    dark: {
      foreground: '#EBDBB2', background: '#1D2021', cursor: '#FE8019',
      cursorAccent: '#1D2021', selectionForeground: '#EBDBB2',
      selectionBackground: 'rgba(254, 128, 25, 0.18)',
      black: '#1D2021', red: '#FB4934', green: '#B8BB26', yellow: '#FABD2F',
      blue: '#83A598', magenta: '#D3869B', cyan: '#8EC07C', white: '#D5C4A1',
      brightBlack: '#504945', brightRed: '#FB4934', brightGreen: '#B8BB26',
      brightYellow: '#FABD2F', brightBlue: '#83A598', brightMagenta: '#D3869B',
      brightCyan: '#8EC07C', brightWhite: '#EBDBB2',
    },
    light: {
      foreground: '#3C3836', background: '#FBF1C7', cursor: '#CC6A18',
      cursorAccent: '#FBF1C7', selectionForeground: '#3C3836',
      selectionBackground: 'rgba(204, 106, 24, 0.12)',
      black: '#3C3836', red: '#CC241D', green: '#98971A', yellow: '#D79921',
      blue: '#458588', magenta: '#B16286', cyan: '#689D6A', white: '#7C6F64',
      brightBlack: '#665C54', brightRed: '#CC241D', brightGreen: '#98971A',
      brightYellow: '#D79921', brightBlue: '#458588', brightMagenta: '#B16286',
      brightCyan: '#689D6A', brightWhite: '#504945',
    },
  },
  nord: {
    dark: {
      foreground: '#D8DEE9', background: '#2E3440', cursor: '#88C0D0',
      cursorAccent: '#2E3440', selectionForeground: '#D8DEE9',
      selectionBackground: 'rgba(136, 192, 208, 0.25)',
      black: '#3B4252', red: '#BF616A', green: '#A3BE8C', yellow: '#EBCB8B',
      blue: '#81A1C1', magenta: '#B48EAD', cyan: '#88C0D0', white: '#E5E9F0',
      brightBlack: '#4C566A', brightRed: '#BF616A', brightGreen: '#A3BE8C',
      brightYellow: '#EBCB8B', brightBlue: '#81A1C1', brightMagenta: '#B48EAD',
      brightCyan: '#8FBCBB', brightWhite: '#ECEFF4',
    },
    light: {
      foreground: '#2E3440', background: '#ECEFF4', cursor: '#5E81AC',
      cursorAccent: '#ECEFF4', selectionForeground: '#2E3440',
      selectionBackground: 'rgba(94, 129, 172, 0.20)',
      black: '#3B4252', red: '#BF616A', green: '#A3BE8C', yellow: '#EBCB8B',
      blue: '#81A1C1', magenta: '#B48EAD', cyan: '#88C0D0', white: '#4C566A',
      brightBlack: '#4C566A', brightRed: '#BF616A', brightGreen: '#A3BE8C',
      brightYellow: '#EBCB8B', brightBlue: '#81A1C1', brightMagenta: '#B48EAD',
      brightCyan: '#8FBCBB', brightWhite: '#2E3440',
    },
  },
  catppuccin: {
    dark: {
      foreground: '#CDD6F4', background: '#1E1E2E', cursor: '#CBA6F7',
      cursorAccent: '#1E1E2E', selectionForeground: '#CDD6F4',
      selectionBackground: 'rgba(203, 166, 247, 0.25)',
      black: '#181825', red: '#F38BA8', green: '#A6E3A1', yellow: '#F9E2AF',
      blue: '#89B4FA', magenta: '#F5C2E7', cyan: '#94E2D5', white: '#BAC2DE',
      brightBlack: '#45475A', brightRed: '#F38BA8', brightGreen: '#A6E3A1',
      brightYellow: '#F9E2AF', brightBlue: '#89B4FA', brightMagenta: '#F5C2E7',
      brightCyan: '#94E2D5', brightWhite: '#CDD6F4',
    },
    light: {
      foreground: '#4C4F69', background: '#EFF1F5', cursor: '#8839EF',
      cursorAccent: '#EFF1F5', selectionForeground: '#4C4F69',
      selectionBackground: 'rgba(136, 57, 239, 0.18)',
      black: '#5C5F77', red: '#D20F39', green: '#40A02B', yellow: '#DF8E1D',
      blue: '#1E66F5', magenta: '#EA76CB', cyan: '#179299', white: '#ACB0BE',
      brightBlack: '#6C6F85', brightRed: '#D20F39', brightGreen: '#40A02B',
      brightYellow: '#DF8E1D', brightBlue: '#1E66F5', brightMagenta: '#EA76CB',
      brightCyan: '#179299', brightWhite: '#4C4F69',
    },
  },
  zen: {
    dark: {
      foreground: 'rgba(255, 255, 255, 0.92)',
      background: '#000000',
      cursor: '#9ca3af',
      cursorAccent: '#000000',
      selectionForeground: '#000000',
      selectionBackground: 'rgba(156, 163, 175, 0.30)',
      black: '#0a0a0a',
      red: '#f87171',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#f472b6',
      cyan: '#22d3ee',
      white: 'rgba(255, 255, 255, 0.70)',
      brightBlack: '#1a1a1a',
      brightRed: '#fca5a5',
      brightGreen: '#6ee7b7',
      brightYellow: '#fcd34d',
      brightBlue: '#93c5fd',
      brightMagenta: '#fbcfe8',
      brightCyan: '#67e8f9',
      brightWhite: '#ffffff',
    },
    light: {
      foreground: 'rgba(17, 24, 39, 0.90)',
      background: '#ffffff',
      cursor: '#374151',
      cursorAccent: '#ffffff',
      selectionForeground: '#ffffff',
      selectionBackground: 'rgba(55, 65, 81, 0.25)',
      black: '#f2f2f4',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#ec4899',
      cyan: '#06b6d4',
      white: '#9ca3af',
      brightBlack: '#e5e7eb',
      brightRed: '#f87171',
      brightGreen: '#34d399',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#f472b6',
      brightCyan: '#22d3ee',
      brightWhite: '#111827',
    },
  },
}

export function getTerminalTheme(name: TerminalThemeName): TerminalTheme {
  return terminalThemes[name]
}

export function getTerminalColorsForAppTheme(appThemeName: ThemeName, mode: AppTheme): TerminalThemeColors {
  const pair = appThemeTerminalMap[appThemeName]
  if (!pair) return mode === 'dark' ? classicDarkColors : classicLightColors
  return pair[mode]
}

export function resolveTerminalTheme(
  appThemeName: ThemeName,
  appMode: AppTheme,
  terminalThemeOverride: TerminalThemeName | null
): TerminalThemeColors {
  if (terminalThemeOverride) {
    return terminalThemes[terminalThemeOverride].colors
  }
  return getTerminalColorsForAppTheme(appThemeName, appMode)
}
