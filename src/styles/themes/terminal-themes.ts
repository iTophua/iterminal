/**
 * Terminal Theme Definitions
 * 
 * xterm.js ITheme 规范:
 * - background: 背景色
 * - foreground: 前景色（文字颜色）
 * - cursor: 光标颜色
 * - cursorAccent: 光标前景色（文字在光标上的颜色）
 * - selectionBackground: 选中文本背景色
 * - selectionForeground: 选中文本前景色
 * - black ~ white: ANSI 16 颜色
 * - brightBlack ~ brightWhite: ANSI 亮色
 * - extendedAnsi: 扩展 ANSI 颜色
 */

export interface TerminalTheme {
  name: string;
  theme: {
    background: string;
    foreground: string;
    cursor?: string;
    cursorAccent?: string;
    selectionBackground?: string;
    selectionForeground?: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

/**
 * Classic - 传统终端配色 (黑底绿字)
 */
export const ClassicTheme: TerminalTheme = {
  name: 'Classic',
  theme: {
    background: '#000000',
    foreground: '#00ff00',
    cursor: '#00ff00',
    cursorAccent: '#000000',
    selectionBackground: '#00ff00',
    selectionForeground: '#000000',
    black: '#000000',
    red: '#ff0000',
    green: '#00ff00',
    yellow: '#ffff00',
    blue: '#0000ff',
    magenta: '#ff00ff',
    cyan: '#00ffff',
    white: '#ffffff',
    brightBlack: '#808080',
    brightRed: '#ff0000',
    brightGreen: '#00ff00',
    brightYellow: '#ffff00',
    brightBlue: '#0000ff',
    brightMagenta: '#ff00ff',
    brightCyan: '#00ffff',
    brightWhite: '#ffffff',
  },
};

/**
 * Solarized Dark - Solarized 深色主题
 */
export const SolarizedDarkTheme: TerminalTheme = {
  name: 'Solarized Dark',
  theme: {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    selectionForeground: '#839496',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
};

/**
 * Solarized Light - Solarized 浅色主题
 */
export const SolarizedLightTheme: TerminalTheme = {
  name: 'Solarized Light',
  theme: {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    cursorAccent: '#fdf6e3',
    selectionBackground: '#eee8d5',
    selectionForeground: '#657b83',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
};

/**
 * Dracula - Dracula 主题配色
 */
export const DraculaTheme: TerminalTheme = {
  name: 'Dracula',
  theme: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selectionBackground: '#44475a',
    selectionForeground: '#f8f8f2',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#5af78e',
    brightYellow: '#f4dbbf',
    brightBlue: '#caa9fa',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
};

/**
 * One Dark - Atom One Dark 主题
 */
export const OneDarkTheme: TerminalTheme = {
  name: 'One Dark',
  theme: {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    cursorAccent: '#282c34',
    selectionBackground: '#3e4451',
    selectionForeground: '#abb2bf',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },
};

/**
 * 所有预设主题列表
 */
export const terminalThemes: TerminalTheme[] = [
  ClassicTheme,
  SolarizedDarkTheme,
  SolarizedLightTheme,
  DraculaTheme,
  OneDarkTheme,
];

/**
 * 根据名称获取主题
 */
export function getThemeByName(name: string): TerminalTheme | undefined {
  return terminalThemes.find(theme => theme.name === name);
}