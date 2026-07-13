import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  Button,
  Tooltip,
  Empty,
  Select,
  Input,
  App,
  Tag,
  Spin,
} from 'antd'
import {
  DownloadOutlined,
  ClearOutlined,
  CopyOutlined,
  ReloadOutlined,
  ApiOutlined,
  LinkOutlined,
  LaptopOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  SearchOutlined,
  DashboardOutlined,
  ApiOutlined as ApiIcon,
  GlobalOutlined,
  StopOutlined,
  ScanOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useTerminalStore } from '../stores/terminalStore'
import type { Connection } from '../types/shared'

// ============ 类型 ============

/** 后端持久化的 MCP 日志（camelCase，来自 list_mcp_logs） */
interface McpLog {
  id: number
  operation: string
  connectionId: string | null
  details: string
  success: boolean
  error: string | null
  result: string | null
  createdAt: number
}

/** 后端 emit 的实时事件 payload（snake_case） */
interface McpOperationEvent {
  timestamp: string
  operation: string
  connection_id: string | null
  details: string
  success: boolean
  error: string | null
  result: string | null
}

interface McpLogStats {
  total: number
  success: number
  failed: number
}

// ============ 操作标签 + 颜色（补全至 22 种）============

const operationLabels: Record<string, string> = {
  connect: '连接',
  disconnect: '断开',
  quick_connect: '快速连接',
  list_saved: '列出已保存连接',
  exec: '执行命令',
  monitor: '系统监控',
  network_stats: '网络统计',
  list_processes: '进程列表',
  kill_process: '杀进程',
  list_dir: '列出目录',
  mkdir: '创建目录',
  rm: '删除文件',
  rename: '重命名',
  create_file: '创建文件',
  delete_directory: '删除目录',
  read_file: '读取文件',
  write_file: '写入文件',
  upload: '上传',
  upload_folder: '上传目录',
  download: '下载',
  compress: '压缩',
  extract: '解压',
  search_files: '搜索文件',
}

// 颜色：连接类绿色、断开类黄/红、文件类紫/青/粉、监控类橙/蓝
const getOperationColor = (operation: string): string => {
  const colorMap: Record<string, string> = {
    connect: 'var(--color-success)',
    disconnect: 'var(--color-warning)',
    quick_connect: 'var(--color-success)',
    list_saved: 'var(--color-text-tertiary)',
    exec: 'var(--color-info)',
    monitor: '#fa8c16',
    network_stats: '#fa8c16',
    list_processes: '#fa8c16',
    kill_process: 'var(--color-error)',
    list_dir: '#722ed1',
    mkdir: '#13c2c2',
    rm: 'var(--color-error)',
    rename: '#eb2f96',
    create_file: '#13c2c2',
    delete_directory: 'var(--color-error)',
    read_file: '#722ed1',
    write_file: '#722ed1',
    upload: '#52c41a',
    upload_folder: '#52c41a',
    download: '#1890ff',
    compress: '#a0d911',
    extract: '#a0d911',
    search_files: '#722ed1',
  }
  return colorMap[operation] || 'var(--color-text-secondary)'
}

// 操作图标映射
const getOperationIcon = (operation: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    connect: <LinkOutlined />,
    disconnect: <StopOutlined />,
    quick_connect: <LinkOutlined />,
    list_saved: <LaptopOutlined />,
    exec: <CodeOutlined />,
    monitor: <DashboardOutlined />,
    network_stats: <GlobalOutlined />,
    list_processes: <ScanOutlined />,
    kill_process: <StopOutlined />,
    list_dir: <FolderOpenOutlined />,
    mkdir: <FolderAddOutlined />,
    rm: <DeleteOutlined />,
    rename: <EditOutlined />,
    create_file: <FileTextOutlined />,
    delete_directory: <DeleteOutlined />,
    read_file: <FileTextOutlined />,
    write_file: <EditOutlined />,
    upload: <CloudUploadOutlined />,
    upload_folder: <CloudUploadOutlined />,
    download: <CloudDownloadOutlined />,
    compress: <FolderOpenOutlined />,
    extract: <FolderOpenOutlined />,
    search_files: <SearchOutlined />,
  }
  return iconMap[operation] || <ApiIcon />
}

/** 毫秒时间戳 → 显示字符串 */
function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const PAGE_SIZE = 200

function McpLogs() {
  const { message: msg, modal } = App.useApp()
  const [logs, setLogs] = useState<McpLog[]>([])
  const [stats, setStats] = useState<McpLogStats>({ total: 0, success: 0, failed: 0 })
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<string>('all')
  const [timeRange, setTimeRange] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const unlistenRef = useRef<UnlistenFn | null>(null)
  // 展开查看 exec 结果的日志 id 集合
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 已保存的连接列表，用于把 connectionId 解析为可读的连接名称
  const allConnections = useTerminalStore(s => s.allConnections)
  // connectionId → Connection 映射，O(1) 查找
  const connMap = useMemo(() => {
    const map = new Map<string, Connection>()
    for (const c of allConnections) {
      map.set(c.id, c)
    }
    return map
  }, [allConnections])

  // ============ 加载历史日志 ============
  const loadLogs = useCallback(
    async (resetOffset: boolean = false) => {
      setLoading(true)
      const newOffset = resetOffset ? 0 : offset
      const filterSuccess =
        filter === 'success' ? true : filter === 'fail' ? false : undefined

      try {
        const result = await invoke<McpLog[]>('list_mcp_logs', {
          limit: PAGE_SIZE,
          offset: newOffset,
          filterSuccess: filterSuccess ?? null,
        })

        if (resetOffset) {
          setLogs(result)
          setOffset(PAGE_SIZE)
        } else {
          setLogs(prev => [...prev, ...result])
          setOffset(newOffset + PAGE_SIZE)
        }
        setHasMore(result.length === PAGE_SIZE)
      } catch (err) {
        msg.error(`加载日志失败: ${err}`)
      } finally {
        setLoading(false)
      }
    },
    [offset, filter, msg]
  )

  // 初次加载 + 统计
  useEffect(() => {
    loadLogs(true)
    invoke<McpLogStats>('count_mcp_logs')
      .then(setStats)
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 筛选变化时重新加载
  useEffect(() => {
    loadLogs(true)
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  // ============ 实时监听新日志 ============
  useEffect(() => {
    const setup = async () => {
      unlistenRef.current = await listen<McpOperationEvent>('api-operation', event => {
        const e = event.payload
        // 转换为 McpLog 格式并前插
        const newLog: McpLog = {
          id: Date.now(), // 实时事件无 DB id，用时间戳暂代
          operation: e.operation,
          connectionId: e.connection_id,
          details: e.details,
          success: e.success,
          error: e.error,
          result: e.result,
          createdAt: Date.now(),
        }
        setLogs(prev => [newLog, ...prev].slice(0, PAGE_SIZE * 3)) // 内存上限 600
        setStats(prev => ({
          total: prev.total + 1,
          success: prev.success + (e.success ? 1 : 0),
          failed: prev.failed + (e.success ? 0 : 1),
        }))
      })
    }
    setup()
    return () => {
      unlistenRef.current?.()
    }
  }, [])

  // ============ 前端过滤（时间范围 + 关键词）============
  const filteredLogs = useMemo(() => {
    let result = logs

    // 时间范围
    if (timeRange !== 'all') {
      const now = Date.now()
      const ranges: Record<string, number> = {
        today: 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      }
      const threshold = now - (ranges[timeRange] || 0)
      result = result.filter(l => l.createdAt >= threshold)
    }

    // 关键词搜索
    if (keyword.trim()) {
      const kw = keyword.toLowerCase()
      result = result.filter(
        l =>
          l.operation.toLowerCase().includes(kw) ||
          l.details.toLowerCase().includes(kw) ||
          (l.connectionId || '').toLowerCase().includes(kw)
      )
    }

    return result
  }, [logs, timeRange, keyword])

  // ============ 清空 ============
  const handleClear = useCallback(() => {
    modal.confirm({
      title: '清空全部 MCP 日志',
      content: `将永久删除 ${stats.total} 条日志记录，确定？`,
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await invoke('clear_mcp_logs')
          setLogs([])
          setStats({ total: 0, success: 0, failed: 0 })
          setOffset(0)
          setHasMore(false)
          msg.success('已清空')
        } catch (err) {
          msg.error(`清空失败: ${err}`)
        }
      },
    })
  }, [stats.total, modal, msg])

  // ============ 导出 TSV ============
  const handleDownload = useCallback(() => {
    if (filteredLogs.length === 0) return
    const header = '时间\t操作\t状态\t连接名称\t主机\t详情\t执行结果\t错误\t连接ID\n'
    const content = filteredLogs
      .map(l => {
        const status = l.success ? '成功' : '失败'
        const conn = l.connectionId ? connMap.get(l.connectionId) : null
        const connName = conn?.name || ''
        const host = conn?.host || ''
        const result = (l.result || '').replace(/\t/g, ' ').replace(/\n/g, '\\n')
        return `${formatTime(l.createdAt)}\t${operationLabels[l.operation] || l.operation}\t${status}\t${connName}\t${host}\t${l.details}\t${result}\t${l.error || ''}\t${l.connectionId || ''}`
      })
      .join('\n')
    const blob = new Blob([header + content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mcp-logs-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [filteredLogs, connMap])

  const handleCopy = useCallback(async (text: string) => {
    try {
      await writeText(text)
      msg.success('已复制')
    } catch {
      msg.error('复制失败')
    }
  }, [msg])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-container)',
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
          <ApiOutlined style={{ color: 'var(--color-primary)' }} />
          <span>MCP 操作日志</span>
          <Tag style={{ marginLeft: 4 }}>{stats.total}</Tag>
          {stats.success > 0 && <Tag color="success">成功 {stats.success}</Tag>}
          {stats.failed > 0 && <Tag color="error">失败 {stats.failed}</Tag>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="刷新">
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => {
                loadLogs(true)
                invoke<McpLogStats>('count_mcp_logs').then(setStats).catch(() => {})
              }}
            />
          </Tooltip>
          <Tooltip title="下载日志">
            <Button
              size="small"
              type="text"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              disabled={filteredLogs.length === 0}
            />
          </Tooltip>
          <Tooltip title="清空全部">
            <Button
              size="small"
              type="text"
              danger
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={stats.total === 0}
            />
          </Tooltip>
        </div>
      </div>

      {/* 筛选栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 20px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <Input
          size="small"
          allowClear
          placeholder="搜索操作/详情/连接ID..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ width: 200 }}
        />
        <Select
          size="small"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'success', label: '仅成功' },
            { value: 'fail', label: '仅失败' },
          ]}
          style={{ width: 100 }}
        />
        <Select
          size="small"
          value={timeRange}
          onChange={setTimeRange}
          options={[
            { value: 'all', label: '全部时间' },
            { value: 'today', label: '最近24小时' },
            { value: '7d', label: '最近7天' },
            { value: '30d', label: '最近30天' },
          ]}
          style={{ width: 120 }}
        />
        <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12, marginLeft: 'auto' }}>
          显示 {filteredLogs.length} 条
        </span>
      </div>

      {/* 日志列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 20px' }}>
        {loading && logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
          </div>
        ) : filteredLogs.length === 0 ? (
          <Empty
            description={logs.length === 0 ? '暂无操作记录' : '没有符合条件的记录'}
            style={{ marginTop: 80 }}
          />
        ) : (
          <>
            {filteredLogs.map((log, idx) => {
              const conn = log.connectionId ? connMap.get(log.connectionId) : null
              return (
              <div
                key={`${log.id}-${idx}`}
                style={{
                  padding: '8px 12px',
                  marginBottom: 4,
                  background: 'var(--color-bg-spotlight)',
                  borderRadius: 6,
                  fontSize: 12,
                  borderLeft: `3px solid ${getOperationColor(log.operation)}`,
                }}
              >
                {/* 第一行：时间 + 操作类型 + 状态 + 连接信息 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                    {formatTime(log.createdAt)}
                  </span>
                  <span style={{ color: getOperationColor(log.operation), fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {getOperationIcon(log.operation)}
                    {operationLabels[log.operation] || log.operation}
                  </span>
                  <span
                    style={{
                      color: 'var(--color-text-inverse)',
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 3,
                      background: log.success ? 'var(--color-success)' : 'var(--color-error)',
                    }}
                  >
                    {log.success ? '成功' : '失败'}
                  </span>
                  {conn && (
                    <Tooltip title={`${conn.username}@${conn.host}:${conn.port}`}>
                      <span style={{ color: 'var(--color-text-secondary)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <LinkOutlined style={{ fontSize: 10 }} />
                        {conn.name}
                        <span style={{ color: 'var(--color-text-tertiary)' }}>{conn.host}</span>
                      </span>
                    </Tooltip>
                  )}
                  {log.connectionId && !conn && (
                    <Tooltip title={log.connectionId}>
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>
                        [临时连接 {log.connectionId.slice(0, 8)}]
                      </span>
                    </Tooltip>
                  )}
                </div>
                {/* 第二行：详情/错误 */}
                <div
                  style={{
                    color: log.success ? 'var(--color-text-secondary)' : 'var(--color-error)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <span style={{ flex: 1 }}>{log.error || log.details}</span>
                  {!log.error && log.details && (
                    <Tooltip title="复制">
                      <CopyOutlined
                        onClick={() => handleCopy(log.details)}
                        style={{
                          color: 'var(--color-text-tertiary)',
                          cursor: 'pointer',
                          fontSize: 12,
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                      />
                    </Tooltip>
                  )}
                </div>
                {/* 第三行：exec 结果（可展开/收起） */}
                {log.result && (
                  <div style={{ marginTop: 4 }}>
                    <span
                      onClick={() => toggleExpand(log.id)}
                      style={{ cursor: 'pointer', fontSize: 11, color: 'var(--color-text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {expandedIds.has(log.id) ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
                      执行结果
                    </span>
                    {expandedIds.has(log.id) && (
                      <div style={{
                        marginTop: 4,
                        padding: '6px 8px',
                        background: 'var(--color-fill, rgba(128,128,128,0.08))',
                        borderRadius: 4,
                        border: '1px solid var(--color-border)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        fontSize: 11,
                        fontFamily: 'Menlo, Monaco, monospace',
                        color: 'var(--color-text-secondary)',
                        maxHeight: 300,
                        overflow: 'auto',
                        position: 'relative',
                      }}>
                        <CopyOutlined
                          onClick={() => handleCopy(log.result!)}
                          style={{ position: 'absolute', top: 6, right: 6, color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 12 }}
                        />
                        {log.result}
                      </div>
                    )}
                  </div>
                )}
              </div>
              )
            })}

            {/* 加载更多 */}
            {hasMore && keyword === '' && timeRange === 'all' && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <Button size="small" type="text" loading={loading} onClick={() => loadLogs(false)}>
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default McpLogs
