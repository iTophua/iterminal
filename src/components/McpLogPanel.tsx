import { useEffect, useState, useRef, useMemo } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { Button, Tooltip, Empty, Select } from 'antd'
import { CloseOutlined, DownloadOutlined, ClearOutlined, ApiOutlined } from '@ant-design/icons'

interface McpOperation {
  timestamp: string
  operation: string
  connection_id: string | null
  details: string
  success: boolean
  error: string | null
}

interface McpLogPanelProps {
  visible: boolean
  onClose: () => void
}

const operationLabels: Record<string, string> = {
  connect: '连接',
  disconnect: '断开',
  exec: '执行命令',
  list_dir: '列出目录',
  mkdir: '创建目录',
  rm: '删除',
  rename: '重命名',
  monitor: '系统监控',
}

// 操作类型颜色映射 - 使用 CSS 变量实现主题适配
// 注意：紫色、青色、粉色等语义色保持硬编码，因为它们用于区分操作类型而非跟随主题
const getOperationColor = (operation: string): string => {
  const colorMap: Record<string, string> = {
    connect: 'var(--color-success)',
    disconnect: 'var(--color-warning)',
    exec: 'var(--color-info)',
    list_dir: '#722ed1',  // 紫色 - 语义固定
    mkdir: '#13c2c2',     // 青色 - 语义固定
    rm: 'var(--color-error)',
    rename: '#eb2f96',    // 粉色 - 语义固定
    monitor: '#fa8c16',   // 橙色 - 语义固定
  }
  return colorMap[operation] || 'var(--color-text-secondary)'
}

function McpLogPanel({ visible, onClose }: McpLogPanelProps) {
  const [logs, setLogs] = useState<McpOperation[]>([])
  const [filter, setFilter] = useState<string>('all')
  const unlistenRef = useRef<UnlistenFn | null>(null)

  useEffect(() => {
    const setupListener = async () => {
      unlistenRef.current = await listen<McpOperation>('api-operation', (event) => {
        setLogs(prev => [event.payload, ...prev].slice(0, 500))
      })
    }

    setupListener()

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current()
      }
    }
  }, [])

  const clearLogs = () => {
    setLogs([])
  }

  const downloadLogs = () => {
    if (logs.length === 0) return

    const header = '时间戳\t操作\t状态\t详情\t错误\n'
    const content = logs.map(log => {
      const status = log.success ? '成功' : '失败'
      const error = log.error || ''
      return `${log.timestamp}\t${log.operation}\t${status}\t${log.details}\t${error}`
    }).join('\n')

    const blob = new Blob([header + content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mcp-logs-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs
    if (filter === 'success') return logs.filter(l => l.success)
    return logs.filter(l => !l.success)
  }, [logs, filter])

  const { successCount, failCount } = useMemo(() => {
    return {
      successCount: logs.filter(l => l.success).length,
      failCount: logs.filter(l => !l.success).length,
    }
  }, [logs])

  return (
    <div
      style={{
        width: 360,
        height: '100%',
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text)', fontWeight: 500 }}>
          <ApiOutlined />
          <span>MCP 操作日志</span>
          <span style={{ 
            background: successCount > 0 ? 'var(--color-success)' : 'var(--color-border)', 
            color: 'var(--color-text-inverse)', 
            fontSize: 11, 
            padding: '0 6px', 
            borderRadius: 10,
            marginLeft: 4 
          }}>
            {successCount}
          </span>
          {failCount > 0 && (
            <span style={{ 
              background: 'var(--color-error)', 
              color: 'var(--color-text-inverse)', 
              fontSize: 11, 
              padding: '0 6px', 
              borderRadius: 10 
            }}>
              {failCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Select
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'success', label: '成功' },
              { value: 'fail', label: '失败' },
            ]}
            style={{ width: 70 }}
          />
          <Tooltip title="下载日志">
            <Button
              size="small"
              type="text"
              icon={<DownloadOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }} />}
              onClick={downloadLogs}
              disabled={logs.length === 0}
            />
          </Tooltip>
          <Tooltip title="清空日志">
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }} />}
              onClick={clearLogs}
              disabled={logs.length === 0}
            />
          </Tooltip>
          <CloseOutlined
            onClick={onClose}
            style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {filteredLogs.length === 0 ? (
          <Empty 
            description={logs.length === 0 ? '暂无操作记录' : '没有符合条件的记录'} 
            style={{ marginTop: 60 }}
            imageStyle={{ height: 60 }}
          />
        ) : (
          filteredLogs.map((log, idx) => (
            <div
              key={`${log.timestamp}-${idx}`}
              style={{
                padding: '8px 12px',
                marginBottom: 4,
                background: 'var(--color-bg-spotlight)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>{log.timestamp}</span>
                <span
                  style={{
                    color: getOperationColor(log.operation),
                    fontWeight: 500,
                  }}
                >
                  {operationLabels[log.operation] || log.operation}
                </span>
                <span style={{
                  color: 'var(--color-text-inverse)',
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: log.success ? 'var(--color-success)' : 'var(--color-error)',
                }}>
                  {log.success ? '成功' : '失败'}
                </span>
                {log.connection_id && (
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>
                    [{log.connection_id.slice(0, 8)}]
                  </span>
                )}
              </div>
              <div
                style={{
                  color: log.success ? 'var(--color-text-secondary)' : 'var(--color-error)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {log.error || log.details}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid var(--color-border)',
        textAlign: 'center',
        color: 'var(--color-text-tertiary)',
        fontSize: 11,
        background: 'var(--color-bg-elevated)',
      }}>
        共 {logs.length} 条记录
      </div>
    </div>
  )
}

export default McpLogPanel