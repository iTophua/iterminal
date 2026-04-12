import type { TerminalTheme, TerminalThemeName, TerminalThemeColors } from '../../types/theme'
import type { ThemeName, AppTheme } from '../../types/theme'

const classicDarkColors: TerminalThemeColors = {
  foreground: '#F8F8F2',
  background: '#1E1E1E',
  cursor: '#F8F8F2',
  cursorAccent: '#1E1E1E',
  selectionForeground: '#F8F8F2',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
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
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#1E1E1E', red: '#CD3131', green: '#00BC00', yellow: '#949800',
  blue: '#0451A5', magenta: '#BC05BC', cyan: '#0598BC', white: '#555555',
  brightBlack: '#666666', brightRed: '#CD3131', brightGreen: '#14CE14',
  brightYellow: '#B5BA00', brightBlue: '#0451A5', brightMagenta: '#BC05BC',
  brightCyan: '#0598BC', brightWhite: '#A5A5A5',
}

const solarizedDarkColors: TerminalThemeColors = {
  foreground: '#839496', background: '#002B36', cursor: '#839496',
  cursorAccent: '#002B36', selectionForeground: '#839496',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#073642', red: '#DC322F', green: '#859900', yellow: '#B58900',
  blue: '#268BD2', magenta: '#D33682', cyan: '#2AA198', white: '#EEE8D5',
  brightBlack: '#002B36', brightRed: '#CB4B16', brightGreen: '#586E75',
  brightYellow: '#657B83', brightBlue: '#839496', brightMagenta: '#6C71C4',
  brightCyan: '#93A1A1', brightWhite: '#FDF6E3',
}

const solarizedLightColors: TerminalThemeColors = {
  foreground: '#657B83', background: '#FDF6E3', cursor: '#657B83',
  cursorAccent: '#FDF6E3', selectionForeground: '#657B83',
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
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
  selectionBackground: 'rgba(0, 185, 107, 0.3)',
  black: '#282C34', red: '#E06C75', green: '#98C379', yellow: '#E5C07B',
  blue: '#61AFEF', magenta: '#C678DD', cyan: '#56B6C2', white: '#ABB2BF',
  brightBlack: '#5C6370', brightRed: '#E06C75', brightGreen: '#98C379',
  brightYellow: '#E5C07B', brightBlue: '#61AFEF', brightMagenta: '#C678DD',
  brightCyan: '#56B6C2', brightWhite: '#FFFFFF',
}

export const terminalThemes: Record<TerminalThemeName, TerminalTheme> = {
  'classic': { id: 'classic', name: 'Classic', colors: classicDarkColors },
  'solarized-dark': { id: 'solarized-dark', name: 'Solarized Dark', colors: solarizedDarkColors },
  'solarized-light': { id: 'solarized-light', name: 'Solarized Light', colors: solarizedLightColors },
  'dracula': { id: 'dracula', name: 'Dracula', colors: draculaColors },
  'one-dark': { id: 'one-dark', name: 'One Dark', colors: oneDarkColors },
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
  ocean: {
    dark: {
      foreground: '#D0E8FF', background: '#0A0E1A', cursor: '#4096FF',
      cursorAccent: '#0A0E1A', selectionForeground: '#D0E8FF',
      selectionBackground: 'rgba(64, 150, 255, 0.25)',
      black: '#0A0E1A', red: '#FF7875', green: '#73D13D', yellow: '#FFC53D',
      blue: '#4096FF', magenta: '#B37FEB', cyan: '#59B8FF', white: '#D0E8FF',
      brightBlack: '#223355', brightRed: '#FF9997', brightGreen: '#95DE64',
      brightYellow: '#FFD666', brightBlue: '#69B1FF', brightMagenta: '#CBA6F7',
      brightCyan: '#8BCFFF', brightWhite: '#E6F0FF',
    },
    light: {
      foreground: '#1A2535', background: '#FFFFFF', cursor: '#1677FF',
      cursorAccent: '#FFFFFF', selectionForeground: '#1A2535',
      selectionBackground: 'rgba(22, 119, 255, 0.18)',
      black: '#1A2535', red: '#CF1322', green: '#389E0D', yellow: '#D48806',
      blue: '#1677FF', magenta: '#722ED1', cyan: '#08979C', white: '#555555',
      brightBlack: '#3A4A60', brightRed: '#E54C4C', brightGreen: '#52C41A',
      brightYellow: '#FAAD14', brightBlue: '#4096FF', brightMagenta: '#9254DE',
      brightCyan: '#13C2C2', brightWhite: '#888888',
    },
  },
  sunset: {
    dark: {
      foreground: '#FFEEDD', background: '#141210', cursor: '#FFA940',
      cursorAccent: '#141210', selectionForeground: '#FFEEDD',
      selectionBackground: 'rgba(255, 169, 64, 0.20)',
      black: '#141210', red: '#FF7875', green: '#73D13D', yellow: '#FFD700',
      blue: '#69B1FF', magenta: '#FF85C0', cyan: '#5CCCCC', white: '#FFEEDD',
      brightBlack: '#3A3025', brightRed: '#FF9997', brightGreen: '#95DE64',
      brightYellow: '#FFEB80', brightBlue: '#8EC8FF', brightMagenta: '#FFAACC',
      brightCyan: '#77DDDD', brightWhite: '#FFF5E0',
    },
    light: {
      foreground: '#2A1810', background: '#FFFBF5', cursor: '#D46B08',
      cursorAccent: '#FFFBF5', selectionForeground: '#2A1810',
      selectionBackground: 'rgba(212, 107, 8, 0.15)',
      black: '#2A1810', red: '#CF1322', green: '#389E0D', yellow: '#AD4E00',
      blue: '#1677FF', magenta: '#722ED1', cyan: '#08979C', white: '#555555',
      brightBlack: '#5A4030', brightRed: '#E54C4C', brightGreen: '#52C41A',
      brightYellow: '#FA8C16', brightBlue: '#4096FF', brightMagenta: '#9254DE',
      brightCyan: '#13C2C2', brightWhite: '#888888',
    },
  },
  violet: {
    dark: {
      foreground: '#E8DEF0', background: '#120E1A', cursor: '#B37FEB',
      cursorAccent: '#120E1A', selectionForeground: '#E8DEF0',
      selectionBackground: 'rgba(179, 127, 235, 0.20)',
      black: '#120E1A', red: '#FF7875', green: '#73D13D', yellow: '#FFC53D',
      blue: '#69B1FF', magenta: '#B37FEB', cyan: '#59B8FF', white: '#E8DEF0',
      brightBlack: '#2D2045', brightRed: '#FF9997', brightGreen: '#95DE64',
      brightYellow: '#FFD666', brightBlue: '#8EC8FF', brightMagenta: '#CBA6F7',
      brightCyan: '#8BCFFF', brightWhite: '#F0E6F8',
    },
    light: {
      foreground: '#251535', background: '#FFFFFF', cursor: '#722ED1',
      cursorAccent: '#FFFFFF', selectionForeground: '#251535',
      selectionBackground: 'rgba(114, 46, 209, 0.12)',
      black: '#251535', red: '#CF1322', green: '#389E0D', yellow: '#D48806',
      blue: '#1677FF', magenta: '#722ED1', cyan: '#08979C', white: '#555555',
      brightBlack: '#45305A', brightRed: '#E54C4C', brightGreen: '#52C41A',
      brightYellow: '#FAAD14', brightBlue: '#4096FF', brightMagenta: '#9254DE',
      brightCyan: '#13C2C2', brightWhite: '#888888',
    },
  },
  rose: {
    dark: {
      foreground: '#FFE8F0', background: '#140E12', cursor: '#F759AB',
      cursorAccent: '#140E12', selectionForeground: '#FFE8F0',
      selectionBackground: 'rgba(247, 89, 171, 0.20)',
      black: '#140E12', red: '#FF7875', green: '#73D13D', yellow: '#FFC53D',
      blue: '#69B1FF', magenta: '#F759AB', cyan: '#5CCCCC', white: '#FFE8F0',
      brightBlack: '#35202A', brightRed: '#FF9997', brightGreen: '#95DE64',
      brightYellow: '#FFD666', brightBlue: '#8EC8FF', brightMagenta: '#FF85C0',
      brightCyan: '#77DDDD', brightWhite: '#FFE0EC',
    },
    light: {
      foreground: '#2A1018', background: '#FFFFFF', cursor: '#C41D7F',
      cursorAccent: '#FFFFFF', selectionForeground: '#2A1018',
      selectionBackground: 'rgba(196, 29, 127, 0.10)',
      black: '#2A1018', red: '#CF1322', green: '#389E0D', yellow: '#D48806',
      blue: '#1677FF', magenta: '#C41D7F', cyan: '#08979C', white: '#555555',
      brightBlack: '#5A203A', brightRed: '#E54C4C', brightGreen: '#52C41A',
      brightYellow: '#FAAD14', brightBlue: '#4096FF', brightMagenta: '#EB2F96',
      brightCyan: '#13C2C2', brightWhite: '#888888',
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
  cyber: {
    dark: {
      foreground: '#E0FFFF', background: '#05000A', cursor: '#00F0FF',
      cursorAccent: '#05000A', selectionForeground: '#05000A',
      selectionBackground: 'rgba(0, 240, 255, 0.20)',
      black: '#05000A', red: '#FF2070', green: '#39FF14', yellow: '#FFD700',
      blue: '#00F0FF', magenta: '#FF00A0', cyan: '#5FFFFF', white: '#E0FFFF',
      brightBlack: '#150025', brightRed: '#FF4488', brightGreen: '#66FF44',
      brightYellow: '#FFEE33', brightBlue: '#44FFFF', brightMagenta: '#FF44CC',
      brightCyan: '#88FFFF', brightWhite: '#F0FFFF',
    },
    light: {
      foreground: '#001520', background: '#F0FAFF', cursor: '#00ACC1',
      cursorAccent: '#F0FAFF', selectionForeground: '#001520',
      selectionBackground: 'rgba(0, 172, 193, 0.15)',
      black: '#00101A', red: '#D01050', green: '#00BB44', yellow: '#CC9900',
      blue: '#0099AA', magenta: '#AA0066', cyan: '#00AAAA', white: '#555566',
      brightBlack: '#113340', brightRed: '#E03070', brightGreen: '#30DD55',
      brightYellow: '#DDBB22', brightBlue: '#22CCCC', brightMagenta: '#CC2288',
      brightCyan: '#22DDDD', brightWhite: '#8899AA',
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
  catppuccin: {
    dark: {
      foreground: '#CDD6F4', background: '#1E1829', cursor: '#CBA6F7',
      cursorAccent: '#1E1829', selectionForeground: '#CDD6F4',
      selectionBackground: 'rgba(203, 166, 247, 0.18)',
      black: '#181425', red: '#F38BA8', green: '#A6E3A1', yellow: '#F9E2AF',
      blue: '#89B4FA', magenta: '#CBA6F7', cyan: '#94E2D5', white: '#BAC2DE',
      brightBlack: '#453544', brightRed: '#F38BA8', brightGreen: '#A6E3A1',
      brightYellow: '#F9E2AF', brightBlue: '#89B4FA', brightMagenta: '#CBA6F7',
      brightCyan: '#94E2D5', brightWhite: '#CDD6F4',
    },
    light: {
      foreground: '#37284A', background: '#EFF1F5', cursor: '#A66BBD',
      cursorAccent: '#EFF1F5', selectionForeground: '#37284A',
      selectionBackground: 'rgba(166, 107, 189, 0.12)',
      black: '#37284A', red: '#D9485A', green: '#6B9B37', yellow: '#C48A2A',
      blue: '#5365CC', magenta: '#A66BBD', cyan: '#3A8FB7', white: '#6E6C7E',
      brightBlack: '#7A6588', brightRed: '#E06072', brightGreen: '#80BD47',
      brightYellow: '#D9A238', brightBlue: '#6B82E0', brightMagenta: '#C480DA',
      brightCyan: '#4BA3CD', brightWhite: '#58456A',
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
