import { invoke } from '@tauri-apps/api/core'
import { CommandRecord, MAX_SUGGESTIONS } from '../types/history'
import type { ShellHistoryFile } from '../utils/shellHistory'

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

/**
 * 读取服务器上的 shell 历史文件（~/.bash_history 等）的末尾内容。
 * 文件不存在时后端直接跳过，返回的列表里没有它。
 */
export async function readShellHistory(connectionId: string): Promise<ShellHistoryFile[]> {
  return invoke<ShellHistoryFile[]>('read_shell_history', { connectionId })
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

function normalizeCommand(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ')
}

// 命令归一化结果的缓存，按列表引用失效（store 每次更新都会换新数组）
const normalizeCache = new WeakMap<CommandRecord[], string[]>()

function normalizedTexts(list: CommandRecord[]): string[] {
  let cached = normalizeCache.get(list)
  if (!cached || cached.length !== list.length) {
    cached = list.map(record => normalizeCommand(record.text))
    normalizeCache.set(list, cached)
  }
  return cached
}

/**
 * 取原始命令在「归一化后长度等于 prefix」处的剩余部分。
 * prefix 由 normalizeCommand 得来：连续空白算一个字符，其余一一对应。
 */
function remainderAfter(original: string, prefix: string): string | null {
  let normLen = 0
  let i = 0
  while (i < original.length && normLen < prefix.length) {
    if (/\s/.test(original[i])) {
      while (i < original.length && /\s/.test(original[i])) i++
    } else {
      i++
    }
    normLen++
  }
  return normLen === prefix.length ? original.slice(i) : null
}

/**
 * 命令提示：按前缀在若干份历史里取候选后缀。
 *
 * 匹配忽略大小写、连续空白算一个空格，但返回的后缀取自原始文本——
 * 路径、变量名、参数是区分大小写的，把建议转成小写再写回命令行会悄悄改掉命令。
 *
 * 各来源自身须已按 calculateScore 排好序，这里按得分归并，同分时靠前的来源优先。
 *
 * @param input 光标前的命令行
 * @param sources 候选来源（如本应用的命令历史、导入的服务器历史）
 * @returns 去掉前缀后的后缀，按匹配度排序，最多 MAX_SUGGESTIONS 条
 */
export function findSuggestions(
  input: string,
  ...sources: (CommandRecord[] | undefined)[]
): string[] {
  const prefix = normalizeCommand(input)
  if (!prefix) return []

  const scored: { text: string; score: number }[] = []
  for (const list of sources) {
    if (!list) continue
    const norms = normalizedTexts(list)
    for (let i = 0; i < list.length; i++) {
      const norm = norms[i]
      if (!norm.startsWith(prefix) || norm.length <= prefix.length) continue
      const text = remainderAfter(list[i].text, prefix)
      if (text === null || !text.trim()) continue
      scored.push({ text, score: calculateScore(list[i]) })
    }
  }

  const result: string[] = []
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    if (!result.includes(item.text)) result.push(item.text)
    if (result.length >= MAX_SUGGESTIONS) break
  }
  return result
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