import { useState, useCallback, useEffect } from 'react'
import { Modal, Input, Button, App, Tag, Spin, Tooltip } from 'antd'
import {
  BulbOutlined,
  CopyOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { aiAnalyze, type AiKind } from '../services/ai'

interface AiAssistantModalProps {
  visible: boolean
  /** 预填的待分析文本（通常来自终端选中内容） */
  initialText: string
  onClose: () => void
  /** 将建议命令插入当前活动终端 */
  onInsertCommand?: (command: string) => void
}

export default function AiAssistantModal({
  visible,
  initialText,
  onClose,
  onInsertCommand,
}: AiAssistantModalProps) {
  const { message } = App.useApp()
  const [text, setText] = useState(initialText)
  const [kind, setKind] = useState<AiKind>('explainError')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [suggested, setSuggested] = useState<string | null>(null)

  // 每次打开时同步 initialText（destroyOnClose 下会重挂载，
  // 但 initialText 变化时也需同步，用 useEffect 保险）
  useEffect(() => {
    setText(initialText)
  }, [initialText])

  const handleAnalyze = useCallback(async () => {
    const t = text.trim()
    if (!t) {
      message.warning('请输入要分析的内容')
      return
    }
    setLoading(true)
    setResult('')
    setSuggested(null)
    try {
      const res = await aiAnalyze(t, kind)
      if (res.success) {
        setResult(res.answer)
        setSuggested(res.suggested_command)
      } else {
        message.error(res.answer || '分析失败')
      }
    } catch (err) {
      // Free 构建会走到这里（后端返回错误）
      message.error(typeof err === 'string' ? err : String(err))
    } finally {
      setLoading(false)
    }
  }, [text, kind, message])

  const handleCopy = useCallback(async (cmd: string) => {
    try {
      await writeText(cmd)
      message.success('已复制')
    } catch (err) {
      message.error(`复制失败: ${err}`)
    }
  }, [message])

  const handleInsert = useCallback((cmd: string) => {
    if (onInsertCommand) {
      onInsertCommand(cmd)
      message.success('已插入终端')
      onClose()
    } else {
      handleCopy(cmd)
    }
  }, [onInsertCommand, handleCopy, message, onClose])

  return (
    <Modal
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BulbOutlined style={{ color: 'var(--color-primary)' }} />
          AI 助手
          <Tag color="gold" style={{ marginLeft: 8 }}>Pro</Tag>
        </span>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Tooltip title="解释报错原因并给修复建议">
          <Button
            size="small"
            type={kind === 'explainError' ? 'primary' : 'default'}
            icon={<BulbOutlined />}
            onClick={() => setKind('explainError')}
          >
            解释报错
          </Button>
        </Tooltip>
        <Tooltip title="把需求描述转成 shell 命令">
          <Button
            size="small"
            type={kind === 'natLangToCommand' ? 'primary' : 'default'}
            icon={<ThunderboltOutlined />}
            onClick={() => setKind('natLangToCommand')}
          >
            自然语言转命令
          </Button>
        </Tooltip>
      </div>

      <Input.TextArea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={kind === 'explainError' ? '粘贴报错日志...' : '描述你想执行的命令，如：列出当前目录下最大的 10 个文件'}
        autoSize={{ minRows: 3, maxRows: 8 }}
        style={{ fontFamily: 'Menlo, Monaco, monospace', fontSize: 12 }}
      />

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          AI 助手为 Pro 功能，结果仅供参考
        </span>
        <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={handleAnalyze}>
          分析
        </Button>
      </div>

      {(loading || result) && (
        <div style={{
          marginTop: 16,
          padding: 12,
          background: 'var(--color-fill)',
          borderRadius: 4,
          border: '1px solid var(--color-border)',
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin tip="分析中..." /></div>
          ) : (
            <>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6 }}>
                {result}
              </div>
              {suggested && (
                <div style={{ marginTop: 12, borderTop: '1px dashed var(--color-border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>建议命令：</div>
                  <code style={{
                    display: 'block',
                    padding: '6px 8px',
                    background: 'var(--color-bg-elevated)',
                    borderRadius: 3,
                    fontFamily: 'Menlo, Monaco, monospace',
                    fontSize: 12,
                    color: 'var(--color-primary)',
                  }}>
                    {suggested}
                  </code>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                    <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopy(suggested)}>复制</Button>
                    {onInsertCommand && (
                      <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={() => handleInsert(suggested)}>
                        插入终端
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
