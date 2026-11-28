import { invoke } from '@tauri-apps/api/core'
import { useTerminalStore, type Connection } from '../stores/terminalStore'
import { confirmHostKey, parseHostKeyChallenge, trustHostKey, HostKeyDeclinedError } from './hostKey'

export { HostKeyDeclinedError }

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
  /** 私钥口令 */
  key_passphrase?: string | null
  /** 不传时后端按 key_file / password 推断 */
  auth_method?: Connection['authMethod'] | null
  /** 跳板机：已保存连接的 id */
  jump_host_id?: string | null
}

type ConnectionFields = Pick<
  Connection,
  'host' | 'port' | 'username' | 'password' | 'keyFile' | 'keyPassphrase' | 'authMethod' | 'jumpHostId'
>

/** 把前端 Connection 转成后端 invoke 需要的参数 */
export function toSSHConnection(conn: ConnectionFields): SSHConnectionParams {
  return {
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password || null,
    key_file: conn.keyFile || null,
    key_passphrase: conn.keyPassphrase || null,
    auth_method: conn.authMethod || null,
    jump_host_id: conn.jumpHostId || null,
  }
}

/**
 * 建立 SSH 连接（不创建 shell）。
 *
 * 首次连接或主机密钥变化时后端以「挑战」失败：弹确认框让用户核对指纹，
 * 信任后自动重连；点取消则抛出 HostKeyDeclinedError。
 */
export async function connectSsh(id: string, connection: SSHConnectionParams): Promise<void> {
  try {
    await invoke('connect_ssh', { id, connection })
  } catch (error) {
    const challenge = parseHostKeyChallenge(error)
    if (!challenge) throw error
    const trusted = await confirmHostKey(challenge)
    if (!trusted) throw new HostKeyDeclinedError()
    await trustHostKey(challenge)
    await invoke('connect_ssh', { id, connection })
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
  await connectSsh(conn.id, toSSHConnection(conn))
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
 * 测试连接（不保持连接）。主机密钥的确认流程与 connectSsh 相同。
 */
export async function testConnection(conn: ConnectionFields): Promise<boolean> {
  const connection = toSSHConnection(conn)
  try {
    return await invoke<boolean>('test_connection', { connection })
  } catch (error) {
    const challenge = parseHostKeyChallenge(error)
    if (!challenge) throw error
    const trusted = await confirmHostKey(challenge)
    if (!trusted) throw new HostKeyDeclinedError()
    await trustHostKey(challenge)
    return invoke<boolean>('test_connection', { connection })
  }
}
