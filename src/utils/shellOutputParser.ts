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
  // MCP 通过 mcp-activity 写入终端的活动标记行（如 "[MCP] $ command"、"[MCP] exit code: 0"）。
  // 这些行格式上会被提示符正则误匹配（[MCP] 满足 \[[\w]+\] 且带 $），导致 CommandTracker
  // 把 MCP 执行的命令当成用户输入存入历史，污染命令建议。这里在提示符检测源头排除。
  /\[MCP\]/,
]

const ANSI_ESCAPE_REGEX = /\x1b(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|\][^\x1b]*\x1b\\)/g

/**
 * OSC 序列正则 (用于检测 Shell Integration)
 */
const OSC_REGEX = /\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g

/**
 * OSC 7 序列正则：shell 上报当前工作目录。
 * 格式：\x1b]7;file://hostname/path\x07
 * 捕获组 1 = /path 部分（不含 file://host）
 * 用于终端 cd 后通知文件管理面板跟随切换。
 */
const OSC7_REGEX = /\x1b\]7;file:\/\/[^\/]*(\/[^\x07\x1b]*)?(?:\x07|\x1b\\)/

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
 * 从原始输出中提取 OSC 7 上报的当前目录。
 * 必须在 stripAnsi 之前调用（stripAnsi 会删掉 OSC 序列）。
 * @returns 路径如 "/home/admin"，提取失败返回 null
 */
export function extractCwdFromOsc7(output: string): string | null {
  const match = output.match(OSC7_REGEX)
  if (!match) return null
  // match[1] 是 /path 部分（已由正则捕获组提取）
  const path = match[1]
  if (!path) return '/'
  return decodeURIComponent(path)
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

    // 跳过 MCP 活动标记行（"[MCP] $ ..." / "[MCP] exit code: ..."）：
    // 这些是 mcp-activity 写入终端的回显，不是 shell 真实提示符，
    // 继续向上扫找到真正的用户提示符。
    if (stripped.includes('[MCP]')) continue

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
  /**
   * 外部活动（MCP exec 等）注入终端的文本标记。
   * 设置后，紧接着的若干次 processOutput 中的命令提取会被跳过，
   * 防止注入文本干扰真实命令边界判定（双保险，extractLastCommand 已排除 MCP 行）。
   * 用计数而非布尔：一次 MCP 活动可能跨越多个 shell-output chunk（提示符可能分多次到达）。
   */
  private suppressCount: number = 0
  /**
   * OSC 7 跨 chunk 缓冲。SSH 的 shell-output 事件可能把一个 OSC 7 序列
   * 拆到多个 chunk（前一个 chunk 结尾 \x1b]7;file://host，下一个 chunk 开头 /path\x07），
   * 单 chunk 正则匹配会漏掉。这里暂存未闭合的 OSC 7 头部，跨 chunk 拼接后再匹配。
   */
  private osc7Buffer: string = ''
  
  /**
   * 从（可能跨 chunk 的）输出中提取 OSC 7 上报的当前目录。
   * 把当前 chunk 追加到缓冲，匹配完整的 OSC 7 序列；
   * 匹配失败时若缓冲里有未闭合的 \x1b]7; 头部，则保留到下次拼接，
   * 否则清空缓冲避免无限增长。
   * @returns 路径如 "/home/admin"，提取失败返回 null
   */
  private extractOsc7(output: string): string | null {
    const combined = this.osc7Buffer + output
    const match = combined.match(OSC7_REGEX)
    if (match) {
      const path = match[1]
      // 匹配位置之后可能还有新的未闭合 OSC 7 头部
      // （同一个 chunk 里先 cd 到 A，紧接着又 cd 到 B，第二个序列被截断）。
      // 用 lastIndexOf 在匹配尾部之后查找，保留它到下次拼接，避免丢失。
      const afterMatch = combined.slice(match.index! + match[0].length)
      const headIdx = afterMatch.lastIndexOf('\x1b]7;')
      this.osc7Buffer = headIdx >= 0 && afterMatch.length < 4096
        ? afterMatch.slice(headIdx)
        : ''
      return path ? decodeURIComponent(path) : '/'
    }
    // 未匹配：若含 OSC 7 头部（\x1b]7;）但未闭合（缺结尾 \x07 或 \x1b\\），
    // 保留从最后一个头部开始的部分到下次拼接。
    const headIdx = combined.lastIndexOf('\x1b]7;')
    if (headIdx >= 0) {
      // 防止缓冲无限增长：限制保留长度（OSC 7 路径通常 < 4KB）
      const tail = combined.slice(headIdx)
      this.osc7Buffer = tail.length < 4096 ? tail : ''
    } else {
      this.osc7Buffer = ''
    }
    return null
  }

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
  ): { command: string | null; promptDetected: boolean; shellIntegration?: ReturnType<typeof detectShellIntegration>; cwd?: string | null } {
    const result = {
      command: null as string | null,
      promptDetected: false,
      shellIntegration: undefined as ReturnType<typeof detectShellIntegration> | undefined,
      cwd: null as string | null,
    }

    // OSC 7 CWD 上报检测（在 stripAnsi 之前，否则 payload 被删）
    // 跨 chunk 处理：先把当前 chunk 追加到缓冲，再从缓冲里提取。
    // SSH 流式输出可能把一个 OSC 7 序列拆到多个 shell-output 事件，
    // 单 chunk 正则匹配会漏掉，导致 cd 后文件管理面板不跟随跳转。
    if (output.includes('\x1b]7;') || this.osc7Buffer) {
      const cwd = this.extractOsc7(output)
      if (cwd) {
        result.cwd = cwd
      }
    }

    // 性能短路：大多数输出 chunk 是命令的普通输出文本（非提示符、无 OSC 序列）。
    // 只有当 chunk 可能包含提示符时才需要跑全套正则：
    //   - 含 OSC 133 序列（shell integration 标记）
    //   - 含换行（提示符通常在行尾，多行输出末行可能是提示符）
    //   - 较短且含 $ # ❯ > 等提示符特征字符
    // 这样对高频刷屏输出（top/tail -f/日志）几乎零开销。
    const mayContainPrompt =
      output.includes('\x1b]133;') ||   // OSC 133 shell integration
      output.includes('\n') ||           // 含换行
      (output.length < 64 && /[$#❯>]/.test(output))  // 短文本含提示符特征
    if (!mayContainPrompt) {
      return result
    }

    const integration = detectShellIntegration(output)
    result.shellIntegration = integration
    
    if (integration.hasIntegration) {

      if (integration.commandFinished) {
        // MCP 等外部活动注入终端后跳过本次提取（双保险，extractLastCommand 已排除 MCP 行）
        if (this.suppressCount > 0) {
          this.suppressCount--
        } else {
          const command = extractLastCommand(terminal, this.lastPromptLine)
          if (command) {
            const cleanCommand = command.replace(/\^([CDZ])/g, '').trim()
            if (cleanCommand && !this.isBlacklisted(cleanCommand) && cleanCommand !== this.lastExtractedCommand) {
              result.command = cleanCommand
              this.lastExtractedCommand = cleanCommand
            }
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
        // MCP 等外部活动注入终端后跳过本次提取（双保险，extractLastCommand 已排除 MCP 行）
        if (this.suppressCount > 0) {
          this.suppressCount--
        } else {
          const command = extractLastCommand(terminal, this.lastPromptLine)
          if (command) {
            const cleanCommand = command.replace(/\^([CDZ])/g, '').trim()
            if (cleanCommand && !this.isBlacklisted(cleanCommand) && cleanCommand !== this.lastExtractedCommand) {
              result.command = cleanCommand
              this.lastExtractedCommand = cleanCommand
            }
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
    this.suppressCount = 0
  }
  
  getPendingCommand(): string {
    return this.pendingCommand
  }
  
  clearPendingCommand(): void {
    this.pendingCommand = ''
  }

  /**
   * 标记接下来的 n 次命令提取为抑制（跳过）。
   * 用于外部活动（MCP exec 等）向终端注入文本后，防止紧随其后的提示符
   * 触发命令提取把注入的命令误存入历史。默认抑制 2 次（覆盖提示符 + 完成两个阶段）。
   */
  suppressNext(n: number = 2): void {
    this.suppressCount = Math.max(this.suppressCount, n)
  }
}

/**
 * 创建命令追踪器实例
 */
export function createCommandTracker(): CommandTracker {
  return new CommandTracker()
}