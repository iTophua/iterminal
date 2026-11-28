import { invoke } from '@tauri-apps/api/core'

/**
 * 导入 ~/.ssh/config（解析在后端 ssh_config.rs）。
 */

export interface SshConfigEntry {
  /** Host 别名，导入后作为连接名 */
  alias: string
  host_name: string
  port: number
  user: string | null
  identity_file: string | null
  proxy_jump: string | null
  /** 用了没法照搬的配置（如 ProxyCommand），这类条目导入时会跳过 */
  unsupported: string | null
  line: number
}

export interface SshConfigImportResult {
  imported: number
  /** 已存在同样主机/端口/用户名的连接，跳过的别名 */
  skipped: string[]
}

export function previewSshConfig(): Promise<SshConfigEntry[]> {
  return invoke<SshConfigEntry[]>('preview_ssh_config')
}

export function importSshConfig(entries: SshConfigEntry[], group: string): Promise<SshConfigImportResult> {
  return invoke<SshConfigImportResult>('import_ssh_config', { entries, group })
}
