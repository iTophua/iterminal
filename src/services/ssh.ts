import { invoke } from '@tauri-apps/api/core'
import { useTerminalStore, type Connection } from '../stores/terminalStore'

/**
 * SSH 连接相关 service。
 *
 * 统一封装"连接 → 创建 shell → 加入 store → 可选跳转终端"的完整流程，
 * 供连接列表、终端页快速连接、MCP 事件处理等多处复用。
 */

/** 后端 SSHConnection 参数格式（snake_case） */
export interface SSHConnectionParams {
  host: string
  port: number
  username: string
  password: string | null
  key_file: string | null
}

/** 把前端 Connection 转成后端 invoke 需要的参数 */
export function toSSHConnection(conn: Pick<Connection, 'host' | 'port' | 'username' | 'password' | 'keyFile'>): SSHConnectionParams {
  return {
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password || null,
    key_file: conn.keyFile || null,
  }
}

/**
 * 连接 SSH + 创建 shell + 加入 store。
 * 成功后连接自动设为 activeConnectionId。
 *
 * @param conn 连接信息（含 id）
 * @returns shellId
 */
export async function connectAndCreateTerminal(conn: Connection): Promise<string> {
  await invoke('connect_ssh', {
    id: conn.id,
    connection: toSSHConnection(conn),
  })
  const shellId = await invoke<string>('get_shell', { id: conn.id })
  useTerminalStore.getState().addConnection(conn, shellId)
  return shellId
}

/**
 * 断开 SSH 连接 + 从 store 移除。
 */
export async function disconnectConnection(id: string): Promise<void> {
  await invoke('disconnect_ssh', { id })
  useTerminalStore.getState().removeConnection(id)
}

/**
 * 测试连接（不保持连接）。
 */
export async function testConnection(conn: Pick<Connection, 'host' | 'port' | 'username' | 'password' | 'keyFile'>): Promise<boolean> {
  return invoke<boolean>('test_connection', { connection: toSSHConnection(conn) })
}
