/**
 * 命令过滤黑名单
 * 用于决定哪些命令不需要存储到历史记录
 */

/**
 * 基础命令黑名单
 * 这些命令无论是否有参数都不存储
 */
export const BASE_COMMAND_BLACKLIST = new Set([
  'clear', 'cls', 'exit', 'logout', 'pwd',
])

/**
 * 路径敏感命令
 * 只有不带路径参数时才过滤
 * 如: ls, ls -la 过滤; ls -la /var/log 存储
 */
export const PATH_SENSITIVE_COMMANDS = new Set([
  'ls', 'll', 'la', 'l',
  'cd',
  'cat', 'less', 'head', 'tail', 'more',
])

/**
 * 判断命令是否有路径参数
 * 规则：除去命令和标志后，是否还有非标志参数
 */
function hasPathArgument(cmd: string): boolean {
  const parts = cmd.split(/\s+/)
  // 找到第一个不是标志（-开头）的参数
  for (let i = 1; i < parts.length; i++) {
    if (!parts[i].startsWith('-')) {
      return true
    }
  }
  return false
}

/**
 * 判断命令是否应该保存到历史
 * @param text 命令文本
 * @returns 是否应该保存
 */
export function shouldSaveCommand(text: string): boolean {
  let cmd = text.trim()
  
  if (!cmd) return false
  
  if (cmd.length < 3) return false
  
  if (cmd.includes('\t')) return false
  
  if (cmd.includes('^C') || cmd.includes('^D') || cmd.includes('^Z')) return false
  
  cmd = cmd.toLowerCase()
  
  const firstWord = cmd.split(/\s+/)[0]
  
  if (BASE_COMMAND_BLACKLIST.has(firstWord)) return false
  
  if (PATH_SENSITIVE_COMMANDS.has(firstWord)) {
    return hasPathArgument(cmd)
  }
  
  return true
}