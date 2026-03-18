/**
 * iTerminal 全局配置
 * 集中管理所有硬编码的配置项
 */

// API 服务配置
export const API_CONFIG = {
  /** MCP API 服务端口 */
  PORT: 27149,
  /** API 基础 URL */
  get BASE_URL() {
    return `http://127.0.0.1:${this.PORT}`
  },
  /** API 请求超时 (毫秒) */
  REQUEST_TIMEOUT: 10000,
} as const

// SSH 连接配置
export const SSH_CONFIG = {
  /** 默认 SSH 端口 */
  DEFAULT_PORT: 22,
  /** 连接超时 (毫秒) */
  CONNECT_TIMEOUT: 10000,
  /** 认证超时 (毫秒) */
  AUTH_TIMEOUT: 5000,
  /** 端口可达性检测超时 (毫秒) */
  PORT_CHECK_TIMEOUT: 5000,
} as const

// 终端配置
export const TERMINAL_CONFIG = {
  /** 默认字体 */
  DEFAULT_FONT: 'Menlo',
  /** 默认字体大小 */
  DEFAULT_FONT_SIZE: 14,
  /** 字体大小范围 */
  FONT_SIZE_MIN: 10,
  FONT_SIZE_MAX: 24,
  /** 默认回滚缓冲区行数 */
  DEFAULT_SCROLLBACK: 10000,
  /** 回滚缓冲区范围 */
  SCROLLBACK_MIN: 100,
  SCROLLBACK_MAX: 100000,
  /** ResizeObserver 防抖延迟 (毫秒) */
  RESIZE_DEBOUNCE_DELAY: 150,
} as const

// 端口检测配置
export const PORT_CHECK_CONFIG = {
  /** 端口检测间隔 (毫秒) */
  CHECK_INTERVAL: 600000, // 10 分钟
  /** 端口检测超时 (毫秒) */
  CHECK_TIMEOUT: 5000,
} as const

// 传输配置
export const TRANSFER_CONFIG = {
  /** 传输缓冲区大小 */
  BUFFER_SIZE: 65536,
  /** 进度更新间隔 (毫秒) */
  PROGRESS_UPDATE_INTERVAL: 200,
} as const

// 存储 Key
export const STORAGE_KEYS = {
  CONNECTIONS: 'iterminal_connections',
  THEME: 'iterminal_theme',
  TERMINAL_SETTINGS: 'iterminal_terminal_settings',
  SIDEBAR_COLLAPSED: 'iterminal_sidebar_collapsed',
  TRANSFER_RECORDS: 'iterminal_transfer_records',
  TRANSFER_RETENTION: 'iterminal_transfer_retention',
  MCP_ENABLED: 'iterminal_mcp_enabled',
  AUTO_HIDE_TOOLBAR: 'iterminal_auto_hide_toolbar',
} as const

// 保留时间配置
export const RETENTION_PERIODS = {
  ONE_MONTH: 30 * 24 * 60 * 60 * 1000,
  THREE_MONTHS: 90 * 24 * 60 * 60 * 1000,
  FIVE_MONTHS: 150 * 24 * 60 * 60 * 1000,
} as const

// MCP 状态检查配置
export const MCP_CONFIG = {
  /** 状态检查间隔 (毫秒) */
  STATUS_CHECK_INTERVAL: 1000,
  /** 服务启动等待超时 (毫秒) */
  STARTUP_TIMEOUT: 5000,
  /** 服务停止等待超时 (毫秒) */
  SHUTDOWN_TIMEOUT: 5000,
} as const