import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

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

/** 清空对话的所有消息（保留对话壳） */
export async function clearMessages(id: string): Promise<boolean> {
  return invoke<boolean>('clear_ai_messages', { id })
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

// ============ 流式输出 ============

/** Agent 工具执行事件 */
export interface ToolEvent {
  name: string
  args: string
  /** running | done | confirm */
  status: string
  result?: string
  success?: boolean
  confirmId?: string
}

/** 流式对话的增量事件（后端 emit 的 payload） */
export interface AiChatChunk {
  delta?: string
  done?: boolean
  error?: string
  /** Agent 模式：工具执行事件 */
  tool?: ToolEvent
}

/** 确认危险命令执行（Agent 模式） */
export async function confirmAgentTool(confirmId: string, approved: boolean): Promise<boolean> {
  return invoke<boolean>('confirm_agent_tool', { confirmId, approved })
}

/**
 * 流式发送对话消息。
 *
 * 返回一个带 cancel() 的句柄。每个 token 经 onChunk 回调；
 * 结束/出错时 onChunk 收到 {done:true} 或 {error}。
 * cancel() 会停止生成并清理监听器（防止泄漏）。
 *
 * 实现说明：前端先生成 requestId 并 listen 对应事件，再 invoke。
 * 这样彻底避免「invoke 返回 reqId 后才 listen 导致漏掉开头 chunk」的竞态。
 *
 * options.agentMode: 开启智能体模式，AI 可自主执行命令
 * options.connectionId: Agent 模式需要的 SSH 连接 ID
 */
export async function chatSendStream(
  conversationId: string,
  userText: string,
  context: TerminalContext | undefined,
  onChunk: (chunk: AiChatChunk) => void,
  options?: { agentMode?: boolean; connectionId?: string }
): Promise<{ cancel: () => void }> {
  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  const eventName = `ai-chat-chunk-${requestId}`
  let finished = false

  // 先建立监听，再 invoke（避免竞态）
  const unlisten = await listen<AiChatChunk>(eventName, (event) => {
    onChunk(event.payload)
    // done/error 后立即 unlisten，避免监听器残留
    if (event.payload.done || event.payload.error) {
      if (!finished) {
        finished = true
        unlisten()
      }
    }
  })

  // invoke 在后台执行，不在此 await（调用方通过 onChunk 感知完成）
  invoke('ai_chat_stream', {
    conversationId,
    userText,
    context,
    requestId,
    agentMode: options?.agentMode ?? false,
    connectionIdForAgent: options?.connectionId ?? null,
  })
    .catch((e) => {
      // invoke 失败（如 license 未激活/配置缺失）→ 通过 chunk 通知
      onChunk({ done: true, error: typeof e === 'string' ? e : String(e) })
      if (!finished) {
        finished = true
        unlisten()
      }
    })

  return {
    cancel: () => {
      invoke('stop_ai_chat', { requestId }).catch(() => {})
      if (!finished) {
        finished = true
        unlisten()
      }
    },
  }
}



