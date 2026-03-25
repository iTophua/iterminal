import { invoke } from '@tauri-apps/api/core'
import { CommandRecord, MAX_SUGGESTIONS } from '../types/history'

export async function loadCommandHistory(connectionId: string): Promise<CommandRecord[]> {
  try {
    const records = await invoke<CommandRecord[]>('get_command_history', { connectionId })
    const filtered = (records || []).filter(cmd => !cmd.text.includes('\t'))
    return filtered
  } catch (error) {
    console.error('[HistoryService] Failed to load history:', error)
    return []
  }
}

export async function saveCommandToHistory(connectionId: string, text: string): Promise<void> {
  try {
    await invoke('save_command', { connectionId, text })
  } catch (error) {
    console.error('[HistoryService] Failed to save command:', error)
  }
}

export async function clearCommandHistory(connectionId: string): Promise<void> {
  try {
    await invoke('clear_command_history', { connectionId })
  } catch (error) {
    console.error('[HistoryService] Failed to clear history:', error)
  }
}

/**
 * 匹配历史命令
 * @param prefix 当前输入前缀
 * @param history 历史命令列表
 * @returns 匹配的建议列表
 */
export function matchHistory(prefix: string, history: CommandRecord[]): CommandRecord[] {
  if (!prefix) return []
  
  const normalizedPrefix = prefix.toLowerCase()
  
  return history
    .filter(cmd => cmd.text.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, MAX_SUGGESTIONS)
}

/**
 * 计算命令分数 (用于排序)
 * 权重: 时间 70% + 频率 30%
 */
export function calculateScore(record: CommandRecord): number {
  const now = Date.now()
  const age = now - record.timestamp
  const maxAge = 30 * 24 * 60 * 60 * 1000
  
  const timeScore = Math.max(0, 1 - age / maxAge)
  const countScore = Math.min(1, record.count / 100)
  
  return timeScore * 0.7 + countScore * 0.3
}

/**
 * 排序历史命令
 */
export function sortHistory(history: CommandRecord[]): CommandRecord[] {
  return [...history].sort((a, b) => calculateScore(b) - calculateScore(a))
}