import { invoke } from '@tauri-apps/api/core'

export type AiKind = 'explainError' | 'natLangToCommand'

export interface AiResult {
  success: boolean
  answer: string
  suggested_command: string | null
}

/**
 * AI 助手服务（Pro 功能 ai_assistant）
 *
 * Free 构建的后端 ai_analyze 会返回错误（"需 Pro"）。
 * Pro 构建会注入真实实现，调用 LLM 服务（API Key 在私有仓库）。
 */
export async function aiAnalyze(text: string, kind: AiKind): Promise<AiResult> {
  return invoke<AiResult>('ai_analyze', { text, kind })
}
