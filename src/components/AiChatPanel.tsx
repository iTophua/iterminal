import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import { Button, Tooltip, Empty, Input, Select, App, Tag, Spin, Switch, Dropdown } from 'antd'
import {
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  SendOutlined,
  PlayCircleOutlined,
  MessageOutlined,
  ReloadOutlined,
  MoreOutlined,
  PaperClipOutlined,
  StopOutlined,
  BulbOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  getMessages,
  chatSendStream,
  parseContext,
  type AiConversation,
  type AiMessage,
  type TerminalContext,
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

  // 流式：正在生成的消息 id（用于显示打字光标 + 允许停止）
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
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
    }
  }, [])

  // ---- 加载选中对话的消息 ----
  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoadingMsgs(true)
    getMessages(activeId)
      .then(msgs => { if (!cancelled) setMessages(msgs) })
      .catch(err => { if (!cancelled) message.error(`加载消息失败: ${err}`) })
      .finally(() => { if (!cancelled) setLoadingMsgs(false) })
    return () => { cancelled = true }
  }, [activeId, message])

  // ---- 新消息时自动滚动到底部 ----
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    setSending(true)
    setStreamingId(placeholderId)

    try {
      const { cancel } = await chatSendStream(convId, text, ctx, (chunk) => {
        if (chunk.error) {
          // 出错：把占位消息内容设为错误提示
          setMessages(prev => prev.map(m => m.id === placeholderId
            ? { ...m, content: `⚠️ ${chunk.error}` }
            : m))
          setStreamingId(null)
          cancelRef.current = null
        } else if (chunk.done) {
          // 完成：后端已持久化 assistant 消息。保留占位消息（内容已完整），
          // 下次加载对话时会自动替换为真实 id。仅刷新对话列表（标题可能更新）。
          refreshConversations()
          setStreamingId(null)
          cancelRef.current = null
        } else if (chunk.delta) {
          // 增量拼接
          setMessages(prev => prev.map(m => m.id === placeholderId
            ? { ...m, content: m.content + chunk.delta }
            : m))
        }
      })
      cancelRef.current = cancel
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== optimisticUser.id && m.id !== placeholderId))
      message.error(`发送失败: ${err}`)
      setStreamingId(null)
      cancelRef.current = null
    } finally {
      setSending(false)
    }
  }, [input, sending, activeId, connectionId, attachContext, getTerminalContext, message, refreshConversations])

  // ---- 停止生成 ----
  const handleStop = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
    setStreamingId(null)
    setSending(false)
  }, [])

  // ---- 复制命令 ----
  const handleCopy = useCallback(async (cmd: string) => {
    try {
      await writeText(cmd)
      message.success('已复制')
    } catch (err) {
      message.error(`复制失败: ${err}`)
    }
  }, [message])

  // ---- 快捷提问填充 ----
  const handleQuickPrompt = useCallback((prompt: string) => {
    setInput(prompt)
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  const activeConv = conversations.find(c => c.id === activeId)

  // 快捷提问预设。前两项含选中内容时动态拼接——但不在 render 里取 selection
  //（取 selection 要遍历终端 buffer 200 行，开销大）。改为点击时懒取。
  // 其它预设是固定文案，用 useMemo 缓存。
  const fixedQuickPrompts = useMemo(() => ([
    { label: '查高占用进程', icon: <ThunderboltOutlined />, prompt: '怎么查看 CPU 占用最高的 10 个进程？' },
    { label: '查磁盘空间', icon: <ThunderboltOutlined />, prompt: '怎么查看磁盘空间使用情况？' },
    { label: '查端口占用', icon: <ThunderboltOutlined />, prompt: '怎么查看哪个进程占用了某个端口？' },
  ]), [])

  // 点击「解释报错/优化命令」时才取 selection（避免每次 render 都遍历 buffer）
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
        <MessageOutlined style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
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
                { key: 'delete', label: '删除对话', icon: <DeleteOutlined />, danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'rename') handleRenameConversation(activeConv.id)
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
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 10px' }} className="ai-chat-messages">
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
          <Tag
            style={{ margin: 0, cursor: 'pointer', fontSize: 11 }}
            onClick={handleQuickExplain}
          >
            <BulbOutlined /> 解释报错
          </Tag>
          <Tag
            style={{ margin: 0, cursor: 'pointer', fontSize: 11 }}
            onClick={handleQuickOptimize}
          >
            <ThunderboltOutlined /> 优化命令
          </Tag>
          {fixedQuickPrompts.map(p => (
            <Tag
              key={p.label}
              style={{ margin: 0, cursor: 'pointer', fontSize: 11 }}
              onClick={() => handleQuickPrompt(p.prompt)}
            >
              {p.icon} {p.label}
            </Tag>
          ))}
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
        }}>
          <Tooltip title="开启后，本轮会附带当前终端最近输出和选中文本">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)' }}
              onClick={() => setAttachContext(v => !v)}
            >
              <PaperClipOutlined style={{ color: attachContext ? 'var(--color-primary)' : undefined }} />
              <span style={{ color: attachContext ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>附带终端上下文</span>
              <Switch size="small" checked={attachContext} onChange={setAttachContext} />
            </div>
          </Tooltip>
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
    </div>
  )
}

// ============ 消息气泡（Markdown 渲染）============

const MessageBubble = memo(function MessageBubble({
  message: msg,
  streaming,
  onCopy,
  onInsert,
  onRun,
}: {
  message: AiMessage
  streaming: boolean
  onCopy: (cmd: string) => void
  onInsert?: (cmd: string) => void
  onRun?: (cmd: string) => void
}) {
  const isUser = msg.role === 'user'
  const ctx = parseContext(msg.context)
  // 流式且内容为空时显示加载态
  const isEmpty = streaming && msg.content === ''

  return (
    <div style={{
      marginBottom: 16,
    }}>
      {/* 角色标识 */}
      <div style={{
        fontSize: 11,
        color: 'var(--color-text-tertiary)',
        marginBottom: 4,
        fontWeight: 500,
      }}>
        {isUser ? '我' : 'AI'}
      </div>

      {/* 附带的上下文标签 */}
      {ctx && (ctx.recentOutput || ctx.selection || ctx.cwd) && (
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
      )}

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
  // 自定义比较：只看消息内容/角色/上下文 + streaming 状态。
  // 忽略 onCopy/onInsert/onRun 引用变化（它们语义稳定，引用变化不应触发重渲）。
  // 这样流式拼接当前消息时，历史消息不会重渲（markdown 解析是 CPU 大头）。
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.streaming === next.streaming
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
