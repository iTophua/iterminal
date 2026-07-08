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

// ============ 多轮对话 ============

/** 终端上下文快照（随对话消息发送，让 AI 感知当前终端） */
export interface TerminalContext {
  recentOutput?: string
  selection?: string
  cwd?: string
}

/** AI 对话 */
export interface AiConversation {
  id: string
  title: string
  connectionId: string | null
  createdAt: number
  updatedAt: number
}

/** 对话中的一条消息 */
export interface AiMessage {
  id: string
  conversationId: string
  /** user | assistant | system */
  role: string
  content: string
  /** JSON 字符串：本轮附带的 TerminalContext（仅 user 消息可能有） */
  context: string | null
  createdAt: number
}

/** 列出对话（按 updatedAt 倒序），可按 connection 筛选 */
export async function listConversations(connectionId?: string): Promise<AiConversation[]> {
  return invoke<AiConversation[]>('list_ai_conversations', { connectionId })
}

/** 新建对话 */
export async function createConversation(
  title: string,
  connectionId?: string
): Promise<AiConversation> {
  return invoke<AiConversation>('create_ai_conversation', { title, connectionId })
}

/** 重命名对话 */
export async function renameConversation(id: string, title: string): Promise<boolean> {
  return invoke<boolean>('rename_ai_conversation', { id, title })
}

/** 删除对话（级联删其消息） */
export async function deleteConversation(id: string): Promise<boolean> {
  return invoke<boolean>('delete_ai_conversation', { id })
}

/** 读取对话的所有消息（按时间正序） */
export async function getMessages(conversationId: string): Promise<AiMessage[]> {
  return invoke<AiMessage[]>('get_ai_messages', { conversationId })
}

/** 发送一条用户消息并拿回 assistant 回复（多轮对话） */
export async function chatSend(
  conversationId: string,
  userText: string,
  context?: TerminalContext
): Promise<AiMessage> {
  return invoke<AiMessage>('ai_chat', { conversationId, userText, context })
}

/** 解析消息的 context 字段为 TerminalContext（失败返回 null） */
export function parseContext(context: string | null): TerminalContext | null {
  if (!context) return null
  try {
    return JSON.parse(context) as TerminalContext
  } catch {
    return null
  }
}

