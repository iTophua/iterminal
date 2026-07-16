import { useEffect, useState, useCallback, useRef, memo } from 'react'
import { Button, Tooltip, Empty, Input, Select, App, Tag, Spin, Switch, Dropdown, Modal } from 'antd'
import {
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  SendOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  ReloadOutlined,
  MoreOutlined,
  PaperClipOutlined,
  StopOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ClearOutlined,
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
// 代码高亮配色在 global.css 中用 [data-theme] 选择器自定义，适配亮/暗主题
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  clearMessages,
  getMessages,
  chatSendStream,
  confirmAgentTool,
  parseContext,
  type AiConversation,
  type AiMessage,
  type TerminalContext,
  type ToolEvent,
} from '../services/ai'

interface AiChatPanelProps {
  /** 当前活动连接 id（用于筛选/新建关联对话） */
  connectionId: string | null
  onClose: () => void
  /** 将命令插入当前活动终端（不自动执行） */
  onInsertCommand?: (command: string) => void
  /** 将命令写入终端并执行（追加回车） */
  onRunCommand?: (command: string) => void
  /** 采集当前活动终端的上下文 */
  getTerminalContext?: () => TerminalContext | null
  /** 外部预填输入框（如终端右键「发送到 AI 对话」）。变化时填入输入框并聚焦。 */
  initialText?: string
}

/** 当前选中内容（快捷提问据此拼接），由 getTerminalContext 间接获得 */
function getSelectionFromContext(getTerminalContext?: () => TerminalContext | null): string {
  if (!getTerminalContext) return ''
  const ctx = getTerminalContext()
  return ctx?.selection || ''
}

export default function AiChatPanel({
  connectionId,
  onClose,
  onInsertCommand,
  onRunCommand,
  getTerminalContext,
  initialText,
}: AiChatPanelProps) {
  const { message, modal } = App.useApp()
  const [conversations, setConversations] = useState<AiConversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingConvs, setLoadingConvs] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [attachContext, setAttachContext] = useState(true)
  // Agent 智能体模式开关
  const [agentEnabled, setAgentEnabled] = useState(true)

  // 流式：正在生成的消息 id（用于显示打字光标 + 允许停止）
  const [streamingId, setStreamingId] = useState<string | null>(null)
  // 流式中对应的 conversationId（防止 effect 重新加载覆盖乐观消息）
  const streamingConvRef = useRef<string | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  // Agent 工具步骤（按 messageId 索引）
  const [agentSteps, setAgentSteps] = useState<Record<string, ToolEvent[]>>({})
  // 危险命令确认弹窗
  const [confirmState, setConfirmState] = useState<{ confirmId: string; command: string } | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  // 用户是否停留在底部附近（true=自动跟随新消息，false=用户手动上滚了）
  const stickToBottomRef = useRef(true)
  const inputRef = useRef<any>(null)

  // ---- 加载对话列表 ----
  const refreshConversations = useCallback(async () => {
    setLoadingConvs(true)
    try {
      const list = await listConversations(connectionId || undefined)
      setConversations(list)
      setActiveId(prev => prev && list.some(c => c.id === prev) ? prev : (list[0]?.id ?? null))
    } catch (err) {
      message.error(`加载对话失败: ${err}`)
    } finally {
      setLoadingConvs(false)
    }
  }, [connectionId, message])

  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  // ---- 卸载时取消进行中的流式生成（防止监听器泄漏 + 后端 task 残留）----
  useEffect(() => {
    return () => {
      cancelRef.current?.()
      cancelRef.current = null
      streamingConvRef.current = null
    }
  }, [])

  // ---- 加载选中对话的消息 ----
  // 注意：如果正在对这个对话进行流式生成，跳过加载，避免覆盖正在填充的占位消息。
  // 典型场景：handleSend 新建对话 → setActiveId 触发本 effect → getMessages 返回空
  //   或只含 user 消息 → 覆盖掉正在接收 delta 的 placeholder → 看不到 AI 回复。
  // 但切换到其他对话时正常加载。
  useEffect(() => {
    if (!activeId) {
      setMessages([])
      setAgentSteps({})
      return
    }
    // 正在对此对话流式生成 → 跳过加载（保留乐观消息）
    if (streamingConvRef.current === activeId) return
    // 切换对话时恢复自动跟随到底部
    stickToBottomRef.current = true
    setAgentSteps({})
    let cancelled = false
    setLoadingMsgs(true)
    getMessages(activeId)
      .then(msgs => { if (!cancelled) setMessages(msgs) })
      .catch(err => { if (!cancelled) message.error(`加载消息失败: ${err}`) })
      .finally(() => { if (!cancelled) setLoadingMsgs(false) })
    return () => { cancelled = true }
  }, [activeId, message])

  // ---- 新消息时自动滚动到底部（仅当用户停留在底部附近时）----
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // ---- 检测用户手动滚动：上滚时停止自动跟随，滚回底部时恢复 ----
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    // 距底部 < 60px 视为"在底部"，允许自动跟随
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distFromBottom < 60
  }, [])

  // ---- 外部预填输入框（终端右键「发送到 AI 对话」）----
  useEffect(() => {
    if (initialText !== undefined && initialText !== '') {
      setInput(initialText)
      // 延迟聚焦，确保面板已渲染
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [initialText])

  // ---- 新建对话 ----
  const handleNewConversation = useCallback(async () => {
    try {
      const conv = await createConversation('新对话', connectionId || undefined)
      setConversations(prev => [conv, ...prev])
      setActiveId(conv.id)
      setInput('')
      inputRef.current?.focus()
    } catch (err) {
      message.error(`新建对话失败: ${err}`)
    }
  }, [connectionId, message])

  // ---- 删除对话 ----
  const handleDeleteConversation = useCallback(async (id: string) => {
    modal.confirm({
      title: '删除对话',
      content: '将永久删除该对话及其所有消息，确定？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteConversation(id)
          setConversations(prev => prev.filter(c => c.id !== id))
          if (activeId === id) setActiveId(null)
          message.success('已删除')
        } catch (err) {
          message.error(`删除失败: ${err}`)
        }
      },
    })
  }, [activeId, message, modal])

  // ---- 清空当前会话消息（保留对话壳）----
  const handleClearMessages = useCallback(async (id: string) => {
    modal.confirm({
      title: '清空会话',
      content: '将清空当前会话的所有消息，对话标题保留。确定？',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await clearMessages(id)
          setMessages([])
          setAgentSteps({})
          message.success('已清空')
        } catch (err) {
          message.error(`清空失败: ${err}`)
        }
      },
    })
  }, [message, modal])

  // ---- 重命名对话 ----
  const handleRenameConversation = useCallback(async (id: string) => {
    const conv = conversations.find(c => c.id === id)
    if (!conv) return
    let newTitle = conv.title
    modal.confirm({
      title: '重命名对话',
      content: (
        <Input
          defaultValue={conv.title}
          onChange={e => { newTitle = e.target.value }}
          autoFocus
        />
      ),
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        const t = newTitle.trim()
        if (!t) return
        try {
          await renameConversation(id, t)
          setConversations(prev => prev.map(c => c.id === id ? { ...c, title: t } : c))
        } catch (err) {
          message.error(`重命名失败: ${err}`)
        }
      },
    })
  }, [conversations, message, modal])

  // ---- 发送消息（流式）----
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    // 必须有活动对话；没有则自动建一个
    let convId = activeId
    if (!convId) {
      try {
        const conv = await createConversation('新对话', connectionId || undefined)
        setConversations(prev => [conv, ...prev])
        convId = conv.id
        setActiveId(conv.id)
      } catch (err) {
        message.error(`新建对话失败: ${err}`)
        return
      }
    }

    // 采集上下文一次，复用给乐观消息和真实发送
    const ctx = attachContext ? (getTerminalContext?.() ?? undefined) : undefined

    // 乐观插入 user 消息
    const optimisticUser: AiMessage = {
      id: `tmp-user-${Date.now()}`,
      conversationId: convId,
      role: 'user',
      content: text,
      context: ctx ? JSON.stringify(ctx) : null,
      createdAt: Date.now(),
    }
    // 占位 assistant 消息（流式填充）
    const placeholderId = `tmp-assistant-${Date.now()}`
    const placeholder: AiMessage = {
      id: placeholderId,
      conversationId: convId,
      role: 'assistant',
      content: '',
      context: null,
      createdAt: Date.now() + 1,
    }
    setMessages(prev => [...prev, optimisticUser, placeholder])
    setInput('')
    // 用户主动发送消息，强制跟随到底部看回复
    stickToBottomRef.current = true
    setSending(true)
    setStreamingId(placeholderId)
    streamingConvRef.current = convId

    try {
      const useAgent = agentEnabled && !!connectionId
      const { cancel } = await chatSendStream(convId, text, ctx, (chunk) => {
        if (chunk.error) {
          // 出错：把占位消息内容设为错误提示
          setMessages(prev => prev.map(m => m.id === placeholderId
            ? { ...m, content: `⚠️ ${chunk.error}` }
            : m))
          setStreamingId(null)
          streamingConvRef.current = null
          cancelRef.current = null
        } else if (chunk.done) {
          // 完成：后端已持久化 assistant 消息。保留占位消息（内容已完整），
          // 下次加载对话时会自动替换为真实 id。仅刷新对话列表（标题可能更新）。
          refreshConversations()
          setStreamingId(null)
          streamingConvRef.current = null
          cancelRef.current = null
        } else if (chunk.tool) {
          // Agent 工具事件
          const tool = chunk.tool
          if (tool.status === 'confirm') {
            // 危险命令确认弹窗
            setConfirmState({ confirmId: tool.confirmId!, command: tool.args })
          } else {
            // running / done：累积到 agentSteps
            setAgentSteps(prev => {
              const existing = prev[placeholderId] || []
              // running → 新增一条；done → 更新最后一条同 name+args 的状态
              if (tool.status === 'running') {
                return { ...prev, [placeholderId]: [...existing, { ...tool }] }
              } else {
                // done: 更新最后匹配项
                const updated = [...existing]
                for (let i = updated.length - 1; i >= 0; i--) {
                  if (updated[i].name === tool.name && updated[i].args === tool.args && updated[i].status === 'running') {
                    updated[i] = { ...tool }
                    break
                  }
                }
                return { ...prev, [placeholderId]: updated }
              }
            })
          }
        } else if (chunk.delta) {
          // 增量拼接
          setMessages(prev => prev.map(m => m.id === placeholderId
            ? { ...m, content: m.content + chunk.delta }
            : m))
        }
      }, useAgent ? { agentMode: true, connectionId: connectionId! } : undefined)
      cancelRef.current = cancel
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== optimisticUser.id && m.id !== placeholderId))
      message.error(`发送失败: ${err}`)
      setStreamingId(null)
      streamingConvRef.current = null
      cancelRef.current = null
    } finally {
      setSending(false)
    }
  }, [input, sending, activeId, connectionId, attachContext, agentEnabled, getTerminalContext, message, refreshConversations])

  // ---- 停止生成 ----
  const handleStop = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
    setStreamingId(null)
    streamingConvRef.current = null
    setSending(false)
  }, [])

  // ---- Agent 危险命令确认 ----
  const handleConfirm = useCallback(async (approved: boolean) => {
    if (!confirmState) return
    try {
      await confirmAgentTool(confirmState.confirmId, approved)
    } catch {
      // ignore
    }
    setConfirmState(null)
  }, [confirmState])

  // ---- 复制命令 ----
  const handleCopy = useCallback(async (cmd: string) => {
    try {
      await writeText(cmd)
      message.success('已复制')
    } catch (err) {
      message.error(`复制失败: ${err}`)
    }
  }, [message])

  const activeConv = conversations.find(c => c.id === activeId)

  // 点击「解释报错/优化命令」时才取 selection（避免每次 render 都遍历 buffer）
  // 如果终端有选中文本，会自动拼到提问内容里，用户不需要手动复制粘贴
  const handleQuickExplain = useCallback(() => {
    const sel = getSelectionFromContext(getTerminalContext)
    setInput(sel ? `解释这段终端输出的报错原因并给出修复建议：\n\n${sel}` : '解释这段输出的报错原因并给出修复建议')
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [getTerminalContext])

  const handleQuickOptimize = useCallback(() => {
    const sel = getSelectionFromContext(getTerminalContext)
    setInput(sel ? `优化这条命令：\n\n\`\`\`bash\n${sel}\n\`\`\`` : '优化我接下来要粘贴的命令')
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [getTerminalContext])

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg-container)',
    }}>
      {/* 头部：对话下拉 + 新建 + 关闭 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <RobotOutlined style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
        <Select
          size="small"
          style={{ flex: 1, minWidth: 0 }}
          value={activeId || undefined}
          onChange={setActiveId}
          placeholder={loadingConvs ? '加载中...' : '选择对话'}
          loading={loadingConvs}
          showSearch
          optionFilterProp="label"
          options={conversations.map(c => ({ label: c.title, value: c.id }))}
          notFoundContent={loadingConvs ? null : '暂无对话'}
          allowClear
        />
        {activeConv && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'rename', label: '重命名', icon: <ReloadOutlined /> },
                { key: 'clear', label: '清空会话', icon: <ClearOutlined /> },
                { type: 'divider' as const },
                { key: 'delete', label: '删除对话', icon: <DeleteOutlined />, danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'rename') handleRenameConversation(activeConv.id)
                else if (key === 'clear') handleClearMessages(activeConv.id)
                else if (key === 'delete') handleDeleteConversation(activeConv.id)
              },
            }}
          >
            <Tooltip title="对话操作">
              <Button size="small" type="text" icon={<MoreOutlined />} />
            </Tooltip>
          </Dropdown>
        )}
        <Tooltip title="新建对话">
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={handleNewConversation} />
        </Tooltip>
        <Tooltip title="关闭">
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
        </Tooltip>
      </div>

      {/* 消息区 */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        style={{ flex: 1, overflow: 'auto', padding: '12px 10px' }}
        className="ai-chat-messages"
      >
        {loadingMsgs ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : messages.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={activeId ? '发送第一条消息开始对话' : '新建对话或从下拉选择'}
            style={{ marginTop: 60 }}
          />
        ) : (
          <>
            {messages.map(m => (
              <MessageBubble
                key={m.id}
                message={m}
                streaming={m.id === streamingId}
                agentSteps={agentSteps[m.id]}
                onCopy={handleCopy}
                onInsert={onInsertCommand}
                onRun={onRunCommand}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 输入区 */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        padding: '8px 10px',
        flexShrink: 0,
      }}>
        {/* 快捷提问 */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          marginBottom: 6,
        }}>
          <Tooltip title="自动带上终端选中的内容">
            <Tag
              style={{ margin: 0, cursor: 'pointer', fontSize: 11 }}
              onClick={handleQuickExplain}
            >
              <BulbOutlined /> 解释报错
            </Tag>
          </Tooltip>
          <Tooltip title="自动带上终端选中的命令">
            <Tag
              style={{ margin: 0, cursor: 'pointer', fontSize: 11 }}
              onClick={handleQuickOptimize}
            >
              <ThunderboltOutlined /> 优化命令
            </Tag>
          </Tooltip>
        </div>

        <Input.TextArea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="问点什么... (Enter 发送，Shift+Enter 换行)"
          autoSize={{ minRows: 2, maxRows: 6 }}
          onPressEnter={e => {
            // 中文/日文输入法组合中按回车是确认候选词（keyCode 229），不要发送
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (!e.shiftKey) {
              e.preventDefault()
              if (!sending) handleSend()
            }
          }}
          style={{ fontFamily: 'Menlo, Monaco, monospace', fontSize: 12, resize: 'none' }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          gap: 8,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Tooltip title={connectionId ? "AI 可自主执行命令查看系统状态、诊断问题，危险命令会弹窗确认" : "需要先连接服务器才能使用智能体"}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}
                onClick={() => connectionId && setAgentEnabled(v => !v)}
              >
                <RobotOutlined style={{ color: agentEnabled && connectionId ? 'var(--color-primary)' : undefined }} />
                <span style={{ color: agentEnabled && connectionId ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>智能体</span>
                <Switch size="small" checked={agentEnabled && !!connectionId} onChange={setAgentEnabled} disabled={!connectionId} />
              </div>
            </Tooltip>
            <Tooltip title="开启后，本轮会附带当前终端最近输出和选中文本">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}
                onClick={() => setAttachContext(v => !v)}
              >
                <PaperClipOutlined style={{ color: attachContext ? 'var(--color-primary)' : undefined }} />
                <span style={{ color: attachContext ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>终端上下文</span>
                <Switch size="small" checked={attachContext} onChange={setAttachContext} />
              </div>
            </Tooltip>
          </div>
          {sending ? (
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
            >
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              disabled={!input.trim()}
              onClick={handleSend}
            >
              发送
            </Button>
          )}
        </div>
      </div>

      {/* Agent 危险命令确认弹窗 */}
      <Modal
        open={!!confirmState}
        title="⚠️ AI 请求执行命令"
        okText="允许执行"
        cancelText="拒绝"
        okButtonProps={{ danger: true }}
        onOk={() => handleConfirm(true)}
        onCancel={() => handleConfirm(false)}
      >
        <p style={{ marginBottom: 8 }}>AI 想在服务器上执行以下命令：</p>
        <pre style={{
          padding: '8px 12px',
          background: 'rgba(255,77,79,0.06)',
          border: '1px solid rgba(255,77,79,0.3)',
          borderRadius: 4,
          fontFamily: 'Menlo, Monaco, monospace',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>{confirmState?.command}</pre>
      </Modal>
    </div>
  )
}

// ============ Agent 工具步骤展示 ============

/** 工具名 → 友好标签 */
const toolLabel: Record<string, string> = {
  exec_command: '执行命令',
  read_file: '读取文件',
  system_monitor: '系统监控',
  docker_action: 'Docker',
}

function AgentSteps({ steps }: { steps: ToolEvent[] }) {
  if (!steps || steps.length === 0) return null
  return (
    <div style={{ marginBottom: 8 }}>
      {steps.map((s, i) => (
        <div key={i} style={{
          fontSize: 11,
          padding: '4px 8px',
          margin: '3px 0',
          background: s.success === false ? 'rgba(255,77,79,0.08)' : 'var(--color-fill, rgba(128,128,128,0.08))',
          borderRadius: 4,
          border: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {s.status === 'running' ? (
              <LoadingOutlined style={{ color: 'var(--color-primary)', fontSize: 11 }} />
            ) : s.success === false ? (
              <ExclamationCircleOutlined style={{ color: 'var(--color-error)', fontSize: 11 }} />
            ) : (
              <CheckCircleOutlined style={{ color: 'var(--color-success)', fontSize: 11 }} />
            )}
            <span style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
              {toolLabel[s.name] || s.name}:
            </span>
            <code style={{
              color: 'var(--color-text-secondary)',
              fontFamily: 'Menlo, Monaco, monospace',
              fontSize: 11,
              wordBreak: 'break-all',
              flex: 1,
            }}>{s.args}</code>
          </div>
          {s.result && (
            <pre style={{
              margin: '4px 0 0 0',
              padding: '4px 6px',
              maxHeight: 80,
              overflow: 'auto',
              color: 'var(--color-text-tertiary)',
              fontSize: 10,
              fontFamily: 'Menlo, Monaco, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: 'rgba(0,0,0,0.05)',
              borderRadius: 3,
            }}>{s.result.length > 200 ? s.result.slice(0, 200) + '…' : s.result}</pre>
          )}
        </div>
      ))}
    </div>
  )
}

// ============ 消息气泡（Markdown 渲染）============

const MessageBubble = memo(function MessageBubble({
  message: msg,
  streaming,
  agentSteps,
  onCopy,
  onInsert,
  onRun,
}: {
  message: AiMessage
  streaming: boolean
  agentSteps?: ToolEvent[]
  onCopy: (cmd: string) => void
  onInsert?: (cmd: string) => void
  onRun?: (cmd: string) => void
}) {
  const isUser = msg.role === 'user'
  const ctx = parseContext(msg.context)
  // 流式且内容为空时显示加载态
  const isEmpty = streaming && msg.content === ''

  // 附带的上下文标签
  const contextTags = ctx && (ctx.recentOutput || ctx.selection || ctx.cwd) ? (
    <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {ctx.selection && (
        <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
          <PaperClipOutlined /> 含选中内容
          {ctx.selection.length > 30 ? ` (${ctx.selection.slice(0, 30)}…)` : ` (${ctx.selection})`}
        </Tag>
      )}
      {ctx.recentOutput && (
        <Tag color="geekblue" style={{ margin: 0, fontSize: 11 }}>
          <PaperClipOutlined /> 含最近终端输出
        </Tag>
      )}
      {ctx.cwd && (
        <Tag style={{ margin: 0, fontSize: 11 }}>📁 {ctx.cwd}</Tag>
      )}
    </div>
  ) : null

  // ---- 用户消息：右对齐 + 气泡 ----
  if (isUser) {
    return (
      <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        {contextTags}
        <div style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 12,
          borderTopRightRadius: 4,
          background: 'var(--color-primary)',
          color: '#fff',
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
      </div>
    )
  }

  // ---- AI 消息：左对齐 + 全宽 Markdown（无气泡）----
  return (
    <div style={{
      marginBottom: 16,
    }}>
      <div style={{
        fontSize: 11,
        color: 'var(--color-text-tertiary)',
        marginBottom: 4,
        fontWeight: 500,
      }}>
        AI
      </div>

      {contextTags}

      {/* Agent 工具执行步骤 */}
      <AgentSteps steps={agentSteps || []} />

      {/* 内容 */}
      {isEmpty ? (
        <div style={{ padding: 4 }}><Spin size="small" /></div>
      ) : (
        <div className="ai-chat-content" style={{ position: 'relative', fontSize: 13, lineHeight: 1.6 }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              code: (props) => <CodeBlock {...props} onCopy={onCopy} onInsert={onInsert} onRun={onRun} />,
            }}
          >
            {msg.content + (streaming ? ' ▍' : '')}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}, (prev, next) => {
  // 自定义比较：id 相同时 role/context 必然不变，只需比 content（流式更新）和 streaming。
  // 忽略 onCopy/onInsert/onRun 引用变化（它们语义稳定，引用变化不应触发重渲）。
  // 这样流式拼接当前消息时，历史消息不会重渲（markdown 解析是 CPU 大头）。
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.streaming === next.streaming &&
    prev.agentSteps === next.agentSteps
  )
})

// ============ 代码块（带复制/插入/运行按钮）============

/**
 * 从 react-markdown 传入的 children（React node 数组）中递归提取纯文本。
 *
 * react-markdown v10 的 code 组件，block code 的 children 是多元素数组
 *（含高亮后的 <span>），直接 String(children) 会得到 "[object Object]"。
 */
function extractText(node: React.ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in (node as any)) {
    return extractText((node as any).props.children)
  }
  return ''
}

function CodeBlock({
  className,
  children,
  onCopy,
  onInsert,
  onRun,
}: {
  className?: string
  children?: React.ReactNode
  onCopy: (cmd: string) => void
  onInsert?: (cmd: string) => void
  onRun?: (cmd: string) => void
}) {
  // react-markdown v10: inline code 无 className（language-xxx），block code 有
  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1] : ''
  // 从 React node 中提取纯文本（避免 [object Object]）
  const text = extractText(children).replace(/\n$/, '')
  // 判断是否 inline（无 className 且 children 是单行短文本）
  const isInline = !className && !text.includes('\n')

  if (isInline) {
    return (
      <code style={{
        padding: '1px 4px',
        borderRadius: 3,
        background: 'var(--color-fill, rgba(128,128,128,0.15))',
        fontFamily: 'Menlo, Monaco, monospace',
        fontSize: '0.9em',
      }}>
        {children}
      </code>
    )
  }

  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        {lang && (
          <div style={{
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            padding: '2px 8px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-fill, transparent)',
            textTransform: 'uppercase',
          }}>
            {lang}
          </div>
        )}
        <pre
          className={className}
          style={{
            margin: 0,
            padding: '6px 8px',
            fontFamily: 'Menlo, Monaco, monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowX: 'auto',
          }}
        >
          {children}
        </pre>
        {/* 代码块操作 */}
        <div style={{
          display: 'flex',
          gap: 4,
          padding: '4px 6px',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-fill, transparent)',
          justifyContent: 'flex-end',
        }}>
          <Button size="small" type="text" icon={<CopyOutlined />}
            onClick={() => onCopy(text)}
            style={{ fontSize: 11 }}
          >复制</Button>
          {onInsert && (
            <Button size="small" type="text" icon={<PlayCircleOutlined />}
              onClick={() => onInsert(text)}
              style={{ fontSize: 11 }}
            >插入终端</Button>
          )}
          {onRun && (
            <Button size="small" type="text" danger icon={<SendOutlined />}
              onClick={() => onRun(text)}
              style={{ fontSize: 11 }}
            >运行</Button>
          )}
        </div>
      </div>
    </div>
  )
}
