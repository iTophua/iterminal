/**
 * Shell 输出解析器
 * 用于从终端输出中提取执行的命令
 * 
 * 支持场景：
 * - Tab 补全后执行的命令
 * - 上下键历史导航选择的命令
 * - 用户直接输入的命令
 */

import type { Terminal, IBufferLine } from '@xterm/xterm'

/**
 * 提示符检测正则模式
 * 按优先级排序，越精确的放前面
 */
const PROMPT_PATTERNS: RegExp[] = [
  /❯\s*$/,
  /^[\w\-@.\[\]]+@[\w\-.]+:[~\/\w\-.,]*[\$#]\s*$/,
  /^#\s*$/,
  /^[~\/\w\-.,]*[\$#]\s*$/,
  /^\[[\w\-@.\s~]+\][\$#]\s*$/,
  /^\s*[\$#]\s*$/,
]

const EXCLUDE_PATTERNS: RegExp[] = [
  /['"`][^'"`]*[\$#>][^'"`]*['"`]/,
  /^\s*#.*$/,
  /<<\s*\w+/,
  /^\s*(if|then|else|fi|case|esac|for|while|do|done)\b/,
  /\|/,
  /&&/,
  /\|\|/,
  /;\s*\w/,
  /^\s*$/,
]

const ANSI_ESCAPE_REGEX = /\x1b(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|\][^\x1b]*\x1b\\)/g

/**
 * OSC 序列正则 (用于检测 Shell Integration)
 */
const OSC_REGEX = /\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g

/**
 * Shell Integration OSC 133 序列
 * 用于标记命令边界（如果 shell 支持）
 */
export const SHELL_INTEGRATION = {
  PROMPT_START: '\x1b]133;A\x07',      // 提示符开始
  COMMAND_START: '\x1b]133;B\x07',     // 命令开始
  COMMAND_EXECUTED: '\x1b]133;C\x07',  // 命令执行
  COMMAND_FINISHED: '\x1b]133;D',      // 命令完成 (后跟退出码)
}

/**
 * 清理 ANSI 转义序列
 */
export function stripAnsi(str: string): string {
  return str
    .replace(ANSI_ESCAPE_REGEX, '')
    .replace(OSC_REGEX, '')
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')
    .replace(/\x1b\[[0-9]*[ABCD]/g, '')
    .replace(/\x1b\[[0-9]*[JK]/g, '')
    .replace(/\x1b\[\/?[0-9]+[hl]/g, '')
    .trim()
}

/**
 * 检测一行是否为提示符
 */
export function isPromptLine(line: string): boolean {
  const stripped = stripAnsi(line)
  
  if (!stripped || stripped.trim() === '') {
    return false
  }
  
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(stripped)) {
      return false
    }
  }
  
  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(stripped)) {
      return true
    }
  }
  
  return false
}

/**
 * 从缓冲区行中提取纯文本
 */
function getLineText(line: IBufferLine | undefined, trimRight: boolean = true): string {
  if (!line) return ''
  
  const length = line.length
  let text = ''
  let lastNonWhitespace = -1
  
  for (let i = 0; i < length; i++) {
    const char = line.getCell(i)
    if (char) {
      const chars = char.getChars() || ' '
      text += chars
      if (chars !== ' ') {
        lastNonWhitespace = i
      }
    }
  }
  
  if (trimRight && lastNonWhitespace >= 0) {
    text = text.slice(0, lastNonWhitespace + 1)
  }
  
  return text
}

/**
 * 从终端缓冲区提取最后执行的命令
 * 
 * @param terminal xterm 终端实例
 * @param lastPromptLine 上一个提示符的行号（用于优化扫描范围）
 * @returns 提取的命令文本，如果无法提取则返回 null
 */
export function extractLastCommand(
  terminal: Terminal,
  lastPromptLine: number = -1
): string | null {
  const buffer = terminal.buffer.active
  const cursorY = buffer.cursorY
  const baseY = buffer.baseY
  
  const startLine = Math.max(0, lastPromptLine)
  const endLine = baseY + cursorY
  
  for (let i = endLine; i >= startLine; i--) {
    const line = buffer.getLine(i)
    if (!line) continue
    
    const lineText = getLineText(line)
    const stripped = stripAnsi(lineText)
    
    // 使用更严格的提示符匹配：必须是标准格式
    // 格式：[user@host path]$ 或 user@host:path$ 或 ❯
    const strictPromptMatch = stripped.match(/^(\[[\w\-@.\s~]+\]|[\w\-@.\[\]]+@[\w\-.]+:[~\/\w\-.,]*|❯)\s*[\$#]?\s*/)
    if (strictPromptMatch) {
      const promptLen = strictPromptMatch[0].length
      const commandPart = stripped.slice(promptLen).trim()
      if (commandPart) {
        return commandPart
      }
    }
  }
  
  return null
}

/**
 * 检测提示符的行号
 * 从光标位置向前扫描
 */
export function detectPromptLine(terminal: Terminal): number {
  const buffer = terminal.buffer.active
  const cursorY = buffer.cursorY
  const baseY = buffer.baseY
  const currentLine = baseY + cursorY
  
  // 向前扫描最多 50 行
  const maxLookback = 50
  const startLine = Math.max(0, currentLine - maxLookback)
  
  for (let i = currentLine; i >= startLine; i--) {
    const line = buffer.getLine(i)
    if (!line) continue
    
    const lineText = getLineText(line)
    
    if (isPromptLine(lineText)) {
      return i
    }
  }
  
  return -1
}

/**
 * 检测输出中是否包含 OSC 133 Shell Integration 序列
 */
export function detectShellIntegration(output: string): {
  hasIntegration: boolean
  promptStart: boolean
  commandStart: boolean
  commandExecuted: boolean
  commandFinished: boolean
  exitCode?: string
} {
  const result = {
    hasIntegration: false,
    promptStart: false,
    commandStart: false,
    commandExecuted: false,
    commandFinished: false,
    exitCode: undefined as string | undefined,
  }
  
  // 检测 OSC 133 序列
  const osc133Regex = /\x1b\]133;([A-D])(?:;(\d+))?\x07/g
  let match
  
  while ((match = osc133Regex.exec(output)) !== null) {
    result.hasIntegration = true
    
    switch (match[1]) {
      case 'A':
        result.promptStart = true
        break
      case 'B':
        result.commandStart = true
        break
      case 'C':
        result.commandExecuted = true
        break
      case 'D':
        result.commandFinished = true
        result.exitCode = match[2] || '0'
        break
    }
  }
  
  return result
}

/**
 * 命令追踪器
 * 追踪终端输入输出，提取完整命令
 */
export class CommandTracker {
  private lastPromptLine: number = -1
  private lastExtractedCommand: string = ''
  private pendingCommand: string = ''
  
  recordInput(data: string): void {
    if (data.startsWith('\x1b')) return
    
    if (data === '\r' || data === '\n') {
      return
    }
    
    if (data === '\t') {
      return
    }
    
    if (data === '\x7f' || data === '\b') {
      this.pendingCommand = this.pendingCommand.slice(0, -1)
      return
    }
    
    if (data === '\x15') {
      this.pendingCommand = ''
      return
    }
    
    if (data === '\x0b') {
      return
    }
    
    if (!data.startsWith('\x1b')) {
      this.pendingCommand += data
    }
  }
  
  processOutput(
    output: string,
    terminal: Terminal,
  ): { command: string | null; promptDetected: boolean; shellIntegration?: ReturnType<typeof detectShellIntegration> } {
    const result = {
      command: null as string | null,
      promptDetected: false,
      shellIntegration: undefined as ReturnType<typeof detectShellIntegration> | undefined,
    }
    
    const integration = detectShellIntegration(output)
    result.shellIntegration = integration
    
    if (integration.hasIntegration) {
      
      if (integration.commandFinished) {
        const command = extractLastCommand(terminal, this.lastPromptLine)
        if (command) {
          const cleanCommand = command.replace(/\^([CDZ])/g, '').trim()
          if (cleanCommand && !this.isBlacklisted(cleanCommand) && cleanCommand !== this.lastExtractedCommand) {
            result.command = cleanCommand
            this.lastExtractedCommand = cleanCommand
          }
        }
      }
      
      if (integration.promptStart) {
        this.lastPromptLine = terminal.buffer.active.baseY + terminal.buffer.active.cursorY
        result.promptDetected = true
      }
      
      return result
    }
    
    const strippedOutput = stripAnsi(output)
    
    if (isPromptLine(strippedOutput)) {
      const currentPromptLine = terminal.buffer.active.baseY + terminal.buffer.active.cursorY
      
      if (this.lastPromptLine >= 0 && currentPromptLine > this.lastPromptLine) {
        const command = extractLastCommand(terminal, this.lastPromptLine)
        if (command) {
          const cleanCommand = command.replace(/\^([CDZ])/g, '').trim()
          if (cleanCommand && !this.isBlacklisted(cleanCommand) && cleanCommand !== this.lastExtractedCommand) {
            result.command = cleanCommand
            this.lastExtractedCommand = cleanCommand
          }
        }
      }
      
      this.lastPromptLine = currentPromptLine
      result.promptDetected = true
    }
    
    return result
  }
  
  /**
   * 检查是否为黑名单命令（不保存到历史）
   */
  private isBlacklisted(command: string): boolean {
    const blacklist = [
      /^$/,                    // 空命令
      /^exit$/,               // exit
      /^logout$/,             // logout
      /^clear$/,              // clear
      /^cd\s*$/,              // cd (不带参数)
    ]
    
    const trimmed = command.trim()
    for (const pattern of blacklist) {
      if (pattern.test(trimmed)) {
        return true
      }
    }
    
    return false
  }
  
  reset(): void {
    this.lastPromptLine = -1
    this.lastExtractedCommand = ''
    this.pendingCommand = ''
  }
  
  getPendingCommand(): string {
    return this.pendingCommand
  }
  
  clearPendingCommand(): void {
    this.pendingCommand = ''
  }
}

/**
 * 创建命令追踪器实例
 */
export function createCommandTracker(): CommandTracker {
  return new CommandTracker()
}