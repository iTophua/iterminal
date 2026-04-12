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

export const terminalThemes: Record<TerminalThemeName, TerminalTheme> = {
  'classic': { id: 'classic', name: 'Classic', description: '经典暗色终端风格', colors: classicDarkColors },
  'solarized-dark': { id: 'solarized-dark', name: 'Solarized Dark', description: 'Solarized 深色主题，低对比度护眼', colors: solarizedDarkColors },
  'solarized-light': { id: 'solarized-light', name: 'Solarized Light', description: 'Solarized 浅色主题，明亮柔和', colors: solarizedLightColors },
  'dracula': { id: 'dracula', name: 'Dracula', description: 'Dracula 暗色主题，紫色调高对比', colors: draculaColors },
  'one-dark': { id: 'one-dark', name: 'One Dark', description: 'Atom One Dark 风格，开发者最爱', colors: oneDarkColors },
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
  bladerunner: {
    dark: {
      foreground: '#FFE0C0', background: '#0A0806', cursor: '#FF6B35',
      cursorAccent: '#0A0806', selectionForeground: '#0A0806',
      selectionBackground: 'rgba(255, 107, 53, 0.30)',
      black: '#0A0806', red: '#FF5252', green: '#00E676', yellow: '#FFCC00',
      blue: '#00D4FF', magenta: '#FF00A0', cyan: '#50E0FF', white: '#FFE0C0',
      brightBlack: '#1A1010', brightRed: '#FF7777', brightGreen: '#50FF88',
      brightYellow: '#FFDD44', brightBlue: '#44EEFF', brightMagenta: '#FF44CC',
      brightCyan: '#88FFFF', brightWhite: '#FFF0E0',
    },
    light: {
      foreground: '#1A1210', background: '#F8F5F0', cursor: '#FF6B35',
      cursorAccent: '#F8F5F0', selectionForeground: '#1A1210',
      selectionBackground: 'rgba(255, 107, 53, 0.20)',
      black: '#1A1210', red: '#D32F2F', green: '#00C853', yellow: '#FF8F00',
      blue: '#0091EA', magenta: '#AA0077', cyan: '#00ACC1', white: '#5A4535',
      brightBlack: '#3A2A20', brightRed: '#F44336', brightGreen: '#4CAF50',
      brightYellow: '#FFB300', brightBlue: '#29B6F6', brightMagenta: '#E91E63',
      brightCyan: '#26C6DA', brightWhite: '#7A6050',
    },
  },
  neontokyo: {
    dark: {
      foreground: '#E0D0FF', background: '#0A0515', cursor: '#BD93F9',
      cursorAccent: '#0A0515', selectionForeground: '#0A0515',
      selectionBackground: 'rgba(189, 147, 249, 0.25)',
      black: '#0A0515', red: '#FF5555', green: '#50FA7B', yellow: '#FFB86C',
      blue: '#BD93F9', magenta: '#FF79C6', cyan: '#8BE9FD', white: '#E0D0FF',
      brightBlack: '#1A1030', brightRed: '#FF7777', brightGreen: '#70FF90',
      brightYellow: '#FFCC88', brightBlue: '#D4B3FF', brightMagenta: '#FF99DD',
      brightCyan: '#A0FFFF', brightWhite: '#F0E8FF',
    },
    light: {
      foreground: '#1A1025', background: '#F5F0FA', cursor: '#9B59B6',
      cursorAccent: '#F5F0FA', selectionForeground: '#1A1025',
      selectionBackground: 'rgba(155, 89, 182, 0.18)',
      black: '#1A1025', red: '#D32F2F', green: '#00C853', yellow: '#FF8F00',
      blue: '#0091EA', magenta: '#9B59B6', cyan: '#00ACC1', white: '#553575',
      brightBlack: '#352050', brightRed: '#F44336', brightGreen: '#4CAF50',
      brightYellow: '#FFB300', brightBlue: '#29B6F6', brightMagenta: '#BA68C8',
      brightCyan: '#26C6DA', brightWhite: '#755095',
    },
  },
  quantum: {
    dark: {
      foreground: '#D0F0FF', background: '#050A15', cursor: '#00E5FF',
      cursorAccent: '#050A15', selectionForeground: '#050A15',
      selectionBackground: 'rgba(0, 229, 255, 0.25)',
      black: '#050A15', red: '#FF5252', green: '#00E676', yellow: '#FFCC00',
      blue: '#00E5FF', magenta: '#E040FB', cyan: '#50F0FF', white: '#D0F0FF',
      brightBlack: '#0A1530', brightRed: '#FF7777', brightGreen: '#50FF88',
      brightYellow: '#FFDD44', brightBlue: '#50F0FF', brightMagenta: '#FF60FF',
      brightCyan: '#88FFFF', brightWhite: '#E8F8FF',
    },
    light: {
      foreground: '#0A1520', background: '#F0F8FF', cursor: '#0091EA',
      cursorAccent: '#F0F8FF', selectionForeground: '#0A1520',
      selectionBackground: 'rgba(0, 145, 234, 0.18)',
      black: '#0A1520', red: '#D32F2F', green: '#00C853', yellow: '#FF8F00',
      blue: '#0091EA', magenta: '#AA0077', cyan: '#00ACC1', white: '#3A5065',
      brightBlack: '#1A3045', brightRed: '#F44336', brightGreen: '#4CAF50',
      brightYellow: '#FFB300', brightBlue: '#29B6F6', brightMagenta: '#E91E63',
      brightCyan: '#26C6DA', brightWhite: '#5A7085',
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
      foreground: '#00F0FF', background: '#020008', cursor: '#00F0FF',
      cursorAccent: '#020008', selectionForeground: '#020008',
      selectionBackground: 'rgba(0, 240, 255, 0.30)',
      black: '#020008', red: '#FF2070', green: '#39FF14', yellow: '#FFD700',
      blue: '#00F0FF', magenta: '#FF00A0', cyan: '#5FFFFF', white: '#E0FFFF',
      brightBlack: '#0A0020', brightRed: '#FF4488', brightGreen: '#66FF44',
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
  aurora: {
    dark: {
      foreground: '#E0FFF0', background: '#030712', cursor: '#00FF87',
      cursorAccent: '#030712', selectionForeground: '#030712',
      selectionBackground: 'rgba(0, 255, 135, 0.28)',
      black: '#030712', red: '#FF4466', green: '#00FF87', yellow: '#FFAA00',
      blue: '#6C5CE7', magenta: '#FF6EB4', cyan: '#00FFD1', white: '#E0FFF0',
      brightBlack: '#0A1530', brightRed: '#FF6688', brightGreen: '#33FFAA',
      brightYellow: '#FFCC44', brightBlue: '#8B7CF7', brightMagenta: '#FF99CC',
      brightCyan: '#44FFFF', brightWhite: '#F0FFF8',
    },
    light: {
      foreground: '#0A1A15', background: '#F0FAF5', cursor: '#00CC6A',
      cursorAccent: '#F0FAF5', selectionForeground: '#0A1A15',
      selectionBackground: 'rgba(0, 204, 106, 0.18)',
      black: '#0A1A15', red: '#D32F2F', green: '#00C853', yellow: '#FF8F00',
      blue: '#6C5CE7', magenta: '#E91E63', cyan: '#00ACC1', white: '#2A5535',
      brightBlack: '#1A3525', brightRed: '#F44336', brightGreen: '#4CAF50',
      brightYellow: '#FFB300', brightBlue: '#7E57C2', brightMagenta: '#EC407A',
      brightCyan: '#26C6DA', brightWhite: '#4A7055',
    },
  },
  solarflare: {
    dark: {
      foreground: '#FFE0E8', background: '#080205', cursor: '#FF3860',
      cursorAccent: '#080205', selectionForeground: '#080205',
      selectionBackground: 'rgba(255, 56, 96, 0.28)',
      black: '#080205', red: '#FF3860', green: '#00FF88', yellow: '#FF8800',
      blue: '#00CCFF', magenta: '#FF6090', cyan: '#00E5FF', white: '#FFE0E8',
      brightBlack: '#1A0A10', brightRed: '#FF6680', brightGreen: '#33FFAA',
      brightYellow: '#FFAA44', brightBlue: '#44DDFF', brightMagenta: '#FF88AA',
      brightCyan: '#44FFFF', brightWhite: '#FFF0F5',
    },
    light: {
      foreground: '#1A0A10', background: '#FEF5F7', cursor: '#E62050',
      cursorAccent: '#FEF5F7', selectionForeground: '#1A0A10',
      selectionBackground: 'rgba(230, 32, 80, 0.15)',
      black: '#1A0A10', red: '#D32F2F', green: '#00C853', yellow: '#FF8F00',
      blue: '#2979FF', magenta: '#E91E63', cyan: '#00ACC1', white: '#552535',
      brightBlack: '#351520', brightRed: '#F44336', brightGreen: '#4CAF50',
      brightYellow: '#FFB300', brightBlue: '#2979FF', brightMagenta: '#EC407A',
      brightCyan: '#26C6DA', brightWhite: '#753545',
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
  monokai: {
    dark: {
      foreground: '#FCF9F2', background: '#19181A', cursor: '#FF6188',
      cursorAccent: '#19181A', selectionForeground: '#19181A',
      selectionBackground: 'rgba(255, 97, 136, 0.30)',
      black: '#2D2A2E', red: '#FF6188', green: '#ADDA78', yellow: '#FC9867',
      blue: '#78DCE8', magenta: '#AB9DF2', cyan: '#78DCE8', white: '#FCF9F2',
      brightBlack: '#727072', brightRed: '#FF6188', brightGreen: '#ADDA78',
      brightYellow: '#FC9867', brightBlue: '#78DCE8', brightMagenta: '#AB9DF2',
      brightCyan: '#78DCE8', brightWhite: '#FEFEF6',
    },
    light: {
      foreground: '#2D2A2E', background: '#FCF9F2', cursor: '#D95D6F',
      cursorAccent: '#FCF9F2', selectionForeground: '#2D2A2E',
      selectionBackground: 'rgba(217, 93, 111, 0.18)',
      black: '#403E41', red: '#D95D6F', green: '#86B42B', yellow: '#EDAB46',
      blue: '#569CD6', magenta: '#9A64CD', cyan: '#5FB3B3', white: '#69676C',
      brightBlack: '#727072', brightRed: '#D95D6F', brightGreen: '#86B42B',
      brightYellow: '#EDAB46', brightBlue: '#569CD6', brightMagenta: '#9A64CD',
      brightCyan: '#5FB3B3', brightWhite: '#2D2A2E',
    },
  },
  github: {
    dark: {
      foreground: '#E6EDF3', background: '#0D1117', cursor: '#58A6FF',
      cursorAccent: '#0D1117', selectionForeground: '#0D1117',
      selectionBackground: 'rgba(88, 166, 255, 0.25)',
      black: '#161B22', red: '#FF7B72', green: '#7EE787', yellow: '#E3B341',
      blue: '#79C0FF', magenta: '#D2A8FF', cyan: '#A5D6FF', white: '#E6EDF3',
      brightBlack: '#444C56', brightRed: '#FFA198', brightGreen: '#A5D6FF',
      brightYellow: '#F0E68C', brightBlue: '#A5D6FF', brightMagenta: '#E8B4F8',
      brightCyan: '#B3D4FF', brightWhite: '#FFFFFF',
    },
    light: {
      foreground: '#1F2328', background: '#FFFFFF', cursor: '#0969DA',
      cursorAccent: '#FFFFFF', selectionForeground: '#1F2328',
      selectionBackground: 'rgba(9, 105, 218, 0.20)',
      black: '#24292F', red: '#CF222E', green: '#116329', yellow: '#9A6700',
      blue: '#0969DA', magenta: '#8250DF', cyan: '#1B7C83', white: '#6E7781',
      brightBlack: '#57606A', brightRed: '#A40E26', brightGreen: '#1A7F37',
      brightYellow: '#BF8700', brightBlue: '#218BFF', brightMagenta: '#A475F9',
      brightCyan: '#3192AA', brightWhite: '#1F2328',
    },
  },
  catppuccin: {
    dark: {
      foreground: '#CDD6F4', background: '#1E1E2E', cursor: '#CBA6F7',
      cursorAccent: '#1E1E2E', selectionForeground: '#1E1E2E',
      selectionBackground: 'rgba(203, 166, 247, 0.25)',
      black: '#45475A', red: '#F38BA8', green: '#A6E3A1', yellow: '#F9E2AF',
      blue: '#89B4FA', magenta: '#CBA6F7', cyan: '#94E2D5', white: '#CDD6F4',
      brightBlack: '#585B70', brightRed: '#F38BA8', brightGreen: '#A6E3A1',
      brightYellow: '#F9E2AF', brightBlue: '#89B4FA', brightMagenta: '#CBA6F7',
      brightCyan: '#94E2D5', brightWhite: '#E6E9EF',
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
