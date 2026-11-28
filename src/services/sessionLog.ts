import { invoke } from '@tauri-apps/api/core'
import { SessionLogger, type SessionMeta } from '../utils/sessionLog'

/**
 * 会话日志的落盘走 Rust 命令（session_log.rs）；
 * 前端只负责把终端输出转成纯文本并攒批，见 utils/sessionLog.ts
 */

export function createSessionLogger(dir: string, meta: SessionMeta, onError: (error: unknown) => void): SessionLogger {
  return new SessionLogger(dir, meta, {
    write: (path, content) => invoke('append_session_log', { path, content }),
    onError,
  })
}

/** 日志目录的绝对路径（不存在就创建） */
export function resolveSessionLogDir(dir: string): Promise<string> {
  return invoke<string>('resolve_session_log_dir', { dir })
}
