/**
 * 命令历史相关类型定义
 */

/**
 * 命令记录
 */
export interface CommandRecord {
  /** 命令内容 */
  text: string
  /** 最后执行时间戳 (毫秒) */
  timestamp: number
  /** 执行次数 */
  count: number
}

/**
 * 连接的历史命令缓存
 */
export interface ConnectionHistory {
  /** 连接 ID */
  connectionId: string
  /** 命令列表 (按时间倒序) */
  commands: CommandRecord[]
}

/**
 * 匹配建议
 */
export interface Suggestion {
  /** 完整命令 */
  text: string
  /** 匹配的分数 (用于排序) */
  score: number
}

/**
 * 历史记录存储限制
 */
export const HISTORY_LIMIT_PER_CONNECTION = 1000

/**
 * 匹配结果最大数量
 */
export const MAX_SUGGESTIONS = 10