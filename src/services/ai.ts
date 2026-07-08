import { invoke } from '@tauri-apps/api/core'

export type AiKind = 'explainError' | 'natLangToCommand'

export interface AiResult {
  success: boolean
  answer: string
  suggested_command: string | null
}

/**
 * AI 配置（后端返回，apiKey 脱敏——只有是否已配置的布尔）
 */
export interface AiConfig {
  baseUrl: string
  hasApiKey: boolean
  model: string
}

/**
 * AI 助手服务（Pro 功能 ai_assistant）
 *
 * 使用通用 OpenAI 兼容协议，支持 DeepSeek / MiMo / OpenAI / Ollama / LM Studio 等。
 * Free 构建的后端 ai_analyze 会因 check_feature 拒绝；Pro 构建激活后可用。
 */

export async function aiAnalyze(text: string, kind: AiKind): Promise<AiResult> {
  return invoke<AiResult>('ai_analyze', { text, kind })
}

/** 读取 AI 配置（apiKey 脱敏） */
export async function getAiConfig(): Promise<AiConfig> {
  return invoke<AiConfig>('get_ai_config')
}

/**
 * 保存 AI 配置。
 * @param apiKey undefined 保持原样；'' 清空；'sk-xxx' 更新
 */
export async function saveAiConfig(
  baseUrl: string,
  apiKey: string | undefined,
  model: string
): Promise<AiConfig> {
  return invoke<AiConfig>('save_ai_config', { baseUrl, apiKey, model })
}

/** 拉取可用模型列表（GET {baseUrl}/v1/models） */
export async function listAiModels(
  baseUrl: string,
  apiKey?: string
): Promise<string[]> {
  return invoke<string[]>('list_ai_models', { baseUrl, apiKey })
}

/** 测试连接（发一次最短 chat 请求验证连通+鉴权） */
export async function testAiConnection(
  baseUrl: string,
  apiKey: string | undefined,
  model: string
): Promise<string> {
  return invoke<string>('test_ai_connection', { baseUrl, apiKey, model })
}

/** 常用 Base URL 预设，UI 用 */
export const AI_BASE_URL_PRESETS: Array<{ name: string; url: string; hint: string }> = [
  { name: 'DeepSeek', url: 'https://api.deepseek.com', hint: '官方付费，需 sk- 开头密钥' },
  { name: 'OpenAI', url: 'https://api.openai.com', hint: '官方付费' },
  { name: 'Ollama 本地', url: 'http://localhost:11434', hint: '本地推理引擎，无需密钥' },
  { name: 'LM Studio 本地', url: 'http://localhost:1234', hint: '本地推理引擎，无需密钥' },
]
