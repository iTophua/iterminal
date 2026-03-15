/**
 * 主题类型定义
 * 提供 ThemeMode 和相关接口的类型支持
 */

/** 主题模式类型 */
export type ThemeMode = 'dark' | 'light';

/** 主题偏好设置 */
export interface ThemePreferences {
  mode: ThemeMode;
  followSystem: boolean;
  accentColor?: string;
}

/** 主题配置 */
export interface ThemeConfig {
  mode: ThemeMode;
  colors: ThemeColors;
}

/** 主题颜色配置 */
export interface ThemeColors {
  primary: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  accent: string;
}

/** 主题上下文值 */
export interface ThemeContextValue {
  mode: ThemeMode;
  preferences: ThemePreferences;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setPreferences: (prefs: Partial<ThemePreferences>) => void;
}