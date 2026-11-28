import { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CopyOutlined, DownloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import {
  batchExecute,
  downloadCsv,
  statusText,
  summarize,
  type BatchExecResult,
} from '../services/batchExec'

interface Props {
  open: boolean
  onClose: () => void
  /** 要执行的目标连接 */
  targets: { id: string; name: string }[]
  /** 驾驶舱等自定义样式的地方只借用弹窗时，外面自己放触发按钮 */
  showTrigger?: boolean
  onOpen?: () => void
}

const outputStyle: React.CSSProperties = {
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  fontSize: 12,
  fontFamily: 'Menlo, Monaco, monospace',
}

const PREVIEW_LINES = 3

/** 输出的头几行，表格里一眼扫完；完整内容展开看 */
function preview(result: BatchExecResult): string {
  const detail = [result.error?.trimEnd(), result.output.trimEnd()].filter(Boolean).join('\n')
  if (!detail) return ''
  const lines = detail.split('\n')
  return lines.slice(0, PREVIEW_LINES).join('\n') + (lines.length > PREVIEW_LINES ? '\n…' : '')
}

/** 批量执行：选中的连接上并发跑同一条命令，汇总成表 */
export default function BatchExecModal({ open, onClose, targets, showTrigger = false, onOpen }: Props) {
  const { message } = App.useApp()
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BatchExecResult[] | null>(null)
  const [error, setError] = useState('')

  // 关掉再开是全新的一次：上次的结果和命令不带着走
  useEffect(() => {
    if (!open) {
      setResults(null)
      setError('')
      setCommand('')
    }
  }, [open])

  const run = async () => {
    const cmd = command.trim()
    if (!cmd || targets.length === 0) return
    setRunning(true)
    setError('')
    setResults(null)
    try {
      setResults(await batchExecute(targets.map(target => target.id), cmd))
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const copySummary = async () => {
    if (!results) return
    await navigator.clipboard.writeText(summarize(results))
    message.success('汇总已复制')
  }

  const okCount = results?.filter(result => result.success).length ?? 0

  const columns: ColumnsType<BatchExecResult> = [
    {
      title: '连接',
      dataIndex: 'label',
      width: 180,
      render: (label: string, result) => (
        <Space size={4}>
          <span>{label}</span>
          <Tag color={result.success ? 'success' : result.timed_out ? 'warning' : 'error'}>{statusText(result)}</Tag>
        </Space>
      ),
    },
    {
      title: '输出',
      key: 'output',
      render: (_, result) => {
        const text = preview(result)
        return text ? <pre style={outputStyle}>{text}</pre> : <Typography.Text type="secondary">（无输出）</Typography.Text>
      },
    },
  ]

  return (
    <>
      {showTrigger && (
        <Button icon={<ThunderboltOutlined />} onClick={onOpen} disabled={targets.length === 0}>
          批量执行
        </Button>
      )}
      <Modal
        title={`批量执行（${targets.length} 台）`}
        open={open}
        width={860}
        onCancel={onClose}
        footer={
          <Space>
            {results && (
              <>
                <Button icon={<CopyOutlined />} onClick={() => void copySummary()}>
                  复制汇总
                </Button>
                <Button icon={<DownloadOutlined />} onClick={() => downloadCsv(results, 'batch-exec.csv')}>
                  导出 CSV
                </Button>
              </>
            )}
            <Button onClick={onClose}>关闭</Button>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={running} disabled={!command.trim()} onClick={() => void run()}>
              执行
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          在 {targets.length} 台服务器上并发执行同一条命令。没连接的会临时建连、跑完即断；单台最长 60 秒，超时会带回已收到的输出。
        </Typography.Paragraph>
        <Input.TextArea
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder="df -h /  | sort -k5 -r"
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={running}
          style={{ fontFamily: 'Menlo, Monaco, monospace' }}
          onPressEnter={e => {
            if (!e.shiftKey) {
              e.preventDefault()
              void run()
            }
          }}
        />
        {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}
        {results && (
          <>
            <Typography.Paragraph style={{ marginTop: 12, marginBottom: 8 }}>
              执行完毕：成功 {okCount} / {results.length}
              {okCount < results.length && <Typography.Text type="danger">，{results.length - okCount} 台失败</Typography.Text>}
            </Typography.Paragraph>
            <Table<BatchExecResult>
              size="small"
              rowKey="id"
              pagination={false}
              columns={columns}
              dataSource={results}
              scroll={{ y: 420 }}
              expandable={{
                expandedRowRender: result => (
                  <pre style={{ ...outputStyle, maxHeight: 'none' }}>
                    {[result.error?.trimEnd(), result.output.trimEnd()].filter(Boolean).join('\n') || '（无输出）'}
                  </pre>
                ),
              }}
            />
          </>
        )}
        {running && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            正在执行，等所有服务器返回…
          </Typography.Paragraph>
        )}
      </Modal>
    </>
  )
}
