import type { CommandRecord } from '../types/history'
import { shouldSaveCommand } from '../constants/commandBlacklist'

/**
 * 服务器 shell 历史文件的解析与整理，供命令提示导入候选。
 *
 * 新加的服务器在本应用里还没有执行过命令，只靠本应用的命令历史没有任何提示。
 * 连接时读取服务器上的 ~/.bash_history、~/.zsh_history 等，作为候选的补充来源：
 * 只放在内存里参与命令提示，不写入本地历史，也不进历史弹窗。
 */

/** 导入的历史命令条数上限 */
export const MAX_IMPORTED_HISTORY = 2000
/** 没记时间的命令在排序里当作多久以前（毫秒）——与 calculateScore 的时效窗口一致，得分归零 */
const UNTIMED_AGE = 30 * 24 * 60 * 60 * 1000

export interface ShellHistoryFile {
  /** 文件名，如 .bash_history */
  name: string
  /** 修改时间（Unix 秒），取不到为 null */
  mtime: number | null
  /** 文件末尾的文本 */
  content: string
  /** 文件超过读取上限，只取了末尾 */
  truncated: boolean
}

export interface HistoryEntry {
  text: string
  /** 执行时间（Unix 秒）；文件没记时间则为 null */
  time: number | null
}

// zsh EXTENDED_HISTORY 的行首元信息：`: 1700000000:0;命令`
const ZSH_META = /^: (\d+):\d+;/
// bash 开了 HISTTIMEFORMAT 时，每条命令前一行记它的执行时间
const BASH_TIME = /^#(\d+)$/
// 历史文件里常留有明文凭据，这类命令不导入
const SECRET_PATTERN = /(password|passwd|secret|token|api[_-]?key|access[_-]?key)['"]?\s*[=:]\s*\S+/i

/**
 * 解析 shell 历史文件内容，返回按文件顺序（旧 → 新）的命令。
 * bash / ksh 一行一条；zsh 的多行命令以行尾反斜杠续行。
 * 被截断过的文件首行可能不完整，丢弃。
 */
export function parseShellHistory(file: Pick<ShellHistoryFile, 'content' | 'truncated'>): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const lines = file.content.split('\n')
  let pending: HistoryEntry | null = null
  let bashTime: number | null = null

  lines.forEach((raw, index) => {
    if (index === 0 && file.truncated) return
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) return
    const stamp = BASH_TIME.exec(line)
    if (stamp) {
      bashTime = Number(stamp[1])
      return
    }

    let time = bashTime
    bashTime = null
    let text = line
    const meta = ZSH_META.exec(text)
    if (meta) {
      time = Number(meta[1])
      text = text.slice(meta[0].length)
    }

    if (pending) {
      if (text.endsWith('\\')) {
        pending.text += text.slice(0, -1)
        return
      }
      pending.text += text
      entries.push(pending)
      pending = null
      return
    }
    // 只有带元信息的 zsh 条目才用反斜杠续行
    if (meta && text.endsWith('\\')) {
      pending = { text: text.slice(0, -1), time }
      return
    }
    entries.push({ text, time })
  })

  return entries
}

function isImportable(text: string): boolean {
  // 过短、黑名单命令（clear/exit、不带路径的 ls/cd 等）与本应用历史用同一套规则
  if (!shouldSaveCommand(text)) return false
  if (text.length > 300) return false
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) return false
  if (SECRET_PATTERN.test(text)) return false
  return true
}

/**
 * 把读到的历史文件整理成命令提示候选。
 *
 * - 与本应用已有历史重复的命令不导入（以本应用的为准，那边有使用次数）
 * - 同一命令重复出现只算一次，位置按最后一次（最新）
 * - 返回新 → 旧；记了执行时间的用真实时间，没记的排在其后
 *   （时间当作 30 天前，在按新近度 + 频次排序里自然落在所有有记录的命令后面）
 *
 * @param files 读到的历史文件
 * @param ownTexts 本应用里该连接已有的命令文本
 * @param now 当前时间（毫秒）
 */
export function buildImportedHistory(
  files: ShellHistoryFile[],
  ownTexts: Iterable<string>,
  now: number,
): CommandRecord[] {
  const own = new Set(ownTexts)
  // 统一按旧 → 新处理：文件按修改时间升序，文件内本来就越靠后越新；最后整体反转即新 → 旧
  const ordered = [...files].sort((a, b) => (a.mtime ?? 0) - (b.mtime ?? 0))

  // Map 保持插入顺序：先删再插把重复命令挪到末尾，即它最近一次出现的位置
  const lastSeen = new Map<string, HistoryEntry>()
  for (const file of ordered) {
    for (const entry of parseShellHistory(file)) {
      const text = entry.text.trim()
      if (!isImportable(text) || own.has(text)) continue
      lastSeen.delete(text)
      lastSeen.set(text, { text, time: entry.time })
    }
  }

  const untimedBase = now - UNTIMED_AGE
  let untimed = 0
  return [...lastSeen.values()]
    .reverse()
    .slice(0, MAX_IMPORTED_HISTORY)
    .map(({ text, time }) => ({
      text,
      count: 0,
      timestamp: time !== null ? Math.min(time * 1000, now) : untimedBase - untimed++ * 1000,
    }))
}
