import { useEffect, useState, useCallback, useRef } from 'react'
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
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  getMessages,
  chatSend,
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
}

// 简单的文本 → 段落/代码块分段。不依赖 markdown 库。
// 识别 ``` 代码块；其余作为普通文本（保留换行）。
interface Block {
  type: 'code' | 'text'
  content: string
  lang?: string
}

function splitBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let i = 0
  let buf: string[] = []
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^\s*```(\w*)/)
    if (fence) {
      // 先把累积的文本入栈
      if (buf.length) {
        blocks.push({ type: 'text', content: buf.join('\n') })
        buf = []
      }
      const lang = fence[1] || undefined
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      // 跳过结束 ```
      i++
      blocks.push({ type: 'code', content: code.join('\n'), lang })
    } else {
      buf.push(line)
      i++
    }
  }
  if (buf.length) {
    blocks.push({ type: 'text', content: buf.join('\n') })
  }
  // 去掉首尾空文本块
  return blocks.filter(b => b.content.trim() !== '')
}

export default function AiChatPanel({
  connectionId,
  onClose,
  onInsertCommand,
  onRunCommand,
  getTerminalContext,
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

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<any>(null)

  // ---- 加载对话列表 ----
  const refreshConversations = useCallback(async () => {
    setLoadingConvs(true)
    try {
      const list = await listConversations(connectionId || undefined)
      setConversations(list)
      // 如果当前没有选中对话，选第一个
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

  // ---- 加载选中对话的消息 ----
  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoadingMsgs(true)
    getMessages(activeId)
      .then(msgs => {
        if (!cancelled) setMessages(msgs)
      })
      .catch(err => {
        if (!cancelled) message.error(`加载消息失败: ${err}`)
      })
      .finally(() => {
        if (!cancelled) setLoadingMsgs(false)
      })
    return () => { cancelled = true }
  }, [activeId, message])

  // ---- 新消息时自动滚动到底部 ----
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

  // ---- 发送消息 ----
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
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

    // 采集上下文一次，复用给乐观消息和真实发送（避免两次采集不一致）
    const ctx = attachContext ? (getTerminalContext?.() ?? undefined) : undefined

    // 乐观插入 user 消息（提升响应感）
    const optimisticUser: AiMessage = {
      id: `tmp-user-${Date.now()}`,
      conversationId: convId,
      role: 'user',
      content: text,
      context: ctx ? JSON.stringify(ctx) : null,
      createdAt: Date.now(),
    }
    setMessages(prev => [...prev, optimisticUser])
    setInput('')
    setSending(true)

    try {
      const assistantMsg = await chatSend(convId, text, ctx)
      // 保留乐观 user 消息（内容与后端存的一致）+ 追加 assistant 回复
      setMessages(prev => [...prev, assistantMsg])
      // 刷新对话列表（标题可能被后端自动更新了）
      refreshConversations()
    } catch (err) {
      // 回滚乐观消息
      setMessages(prev => prev.filter(m => m.id !== optimisticUser.id))
      message.error(`发送失败: ${err}`)
    } finally {
      setSending(false)
    }
  }, [input, activeId, connectionId, attachContext, getTerminalContext, message, refreshConversations])

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
        {/* 对话操作菜单（重命名/删除） */}
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
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 10px' }}>
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
                onCopy={handleCopy}
                onInsert={onInsertCommand}
                onRun={onRunCommand}
              />
            ))}
            {sending && (
              <div style={{ textAlign: 'center', padding: 8 }}>
                <Spin size="small" />
              </div>
            )}
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
        <Input.TextArea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="问点什么... (Enter 发送，Shift+Enter 换行)"
          autoSize={{ minRows: 2, maxRows: 6 }}
          onPressEnter={e => {
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
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            loading={sending}
            disabled={!input.trim()}
            onClick={handleSend}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============ 消息气泡 ============

function MessageBubble({
  message: msg,
  onCopy,
  onInsert,
  onRun,
}: {
  message: AiMessage
  onCopy: (cmd: string) => void
  onInsert?: (cmd: string) => void
  onRun?: (cmd: string) => void
}) {
  const isUser = msg.role === 'user'
  const ctx = parseContext(msg.context)
  const blocks = splitBlocks(msg.content)

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '88%',
        padding: '8px 10px',
        borderRadius: 8,
        background: isUser
          ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)'
          : 'var(--color-fill-quaternary, var(--color-fill))',
        border: '1px solid var(--color-border-secondary, var(--color-border))',
      }}>
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
              <Tag style={{ margin: 0, fontSize: 11 }}>
                📁 {ctx.cwd}
              </Tag>
            )}
          </div>
        )}

        {/* 内容块 */}
        {blocks.map((b, i) => {
          if (b.type === 'code') {
            return (
              <div key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>
                <div style={{
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}>
                  {b.lang && (
                    <div style={{
                      fontSize: 10,
                      color: 'var(--color-text-tertiary)',
                      padding: '2px 8px',
                      borderBottom: '1px solid var(--color-border)',
                      background: 'var(--color-fill, transparent)',
                      textTransform: 'uppercase',
                    }}>
                      {b.lang}
                    </div>
                  )}
                  <pre style={{
                    margin: 0,
                    padding: '6px 8px',
                    fontFamily: 'Menlo, Monaco, monospace',
                    fontSize: 12,
                    color: 'var(--color-primary)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    overflowX: 'auto',
                  }}>
                    {b.content}
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
                      onClick={() => onCopy(b.content)}
                      style={{ fontSize: 11 }}
                    >复制</Button>
                    {onInsert && (
                      <Button size="small" type="text" icon={<PlayCircleOutlined />}
                        onClick={() => onInsert(b.content)}
                        style={{ fontSize: 11 }}
                      >插入终端</Button>
                    )}
                    {onRun && (
                      <Button size="small" type="text" danger icon={<SendOutlined />}
                        onClick={() => onRun(b.content)}
                        style={{ fontSize: 11 }}
                      >运行</Button>
                    )}
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div key={i} style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--color-text)',
            }}>
              {b.content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
