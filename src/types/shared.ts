/**
 * iTerminal 共享类型定义
 * 这些类型在前端多处使用，保持一致性
 */

// ============ 连接相关 ============

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  keyFile?: string
  group: string
  tags: string[]
  lastConnectedAt?: string
  status: 'online' | 'offline' | 'connecting'
}

// ============ SSH 命令结果 ============

export interface CommandResult {
  success: boolean
  output: string
  error?: string
}

// ============ 系统监控 ============

export interface SystemInfo {
  hostname: string
  os: string
  kernel: string
  uptime: string
}

export interface CpuInfo {
  usage: number
  cores: number
  load_avg: string
  per_core_usage: number[]
}

export interface MemoryInfo {
  total: number
  used: number
  free: number
  usage_percent: number
  swap_total: number
  swap_used: number
}

export interface DiskInfo {
  filesystem: string
  mount_point: string
  total: number
  used: number
  available: number
  usage_percent: number
}

export interface MonitorData {
  system: SystemInfo
  cpu: CpuInfo
  memory: MemoryInfo
  disks: DiskInfo[]
}

// ============ 文件系统 ============

export interface FileEntry {
  name: string
  path: string
  is_directory: boolean
  size: number
  modified: string
  permissions?: string
}

// ============ 传输相关 ============

export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled'
export type TransferType = 'upload' | 'download'

export interface TransferResult {
  success: boolean
  bytes_transferred: number
  error?: string
  cancelled: boolean
}

// ============ API 相关 ============

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface ApiOperation {
  timestamp: string
  operation: string
  connection_id: string | null
  details: string
  success: boolean
  error: string | null
}

// ============ 终端设置 ============

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
  scrollback: number
  copyOnSelect: boolean
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
}

// ============ 主题相关 ============

export type AppTheme = 'light' | 'dark'
export type AppThemeMode = 'light' | 'dark' | 'system'
export type TerminalThemeName = 'default' | 'pro' | 'dracula' | 'solarized' | 'gruvbox'

// ============ 工具函数 ============

/**
 * 生成唯一 ID
 * 使用时间戳 + 随机字符串，避免毫秒级冲突
 */
export function generateUniqueId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 11)
  return `${timestamp}-${random}`
}

/**
 * 格式化内存大小
 */
export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb} MB`
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 格式化传输速度
 */
export function formatSpeed(bytesPerSecond: number): string {
  return formatFileSize(bytesPerSecond) + '/s'
}