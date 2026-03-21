import { useState } from 'react'
import { List, Button, Tag, Empty, Select, Tabs, Dropdown, Space, Progress, Tooltip, App } from 'antd'
import {
  DownloadOutlined, UploadOutlined, SwapOutlined, FilterOutlined,
  CloseCircleOutlined, ReloadOutlined, PauseOutlined, CaretRightOutlined
} from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTransferStore, RetentionPeriod } from '../stores/transferStore'

type FilterType = 'all' | 'upload' | 'download'

const RETENTION_OPTIONS = [
  { value: '1month' as const, label: '一个月' },
  { value: '3months' as const, label: '三个月' },
  { value: '5months' as const, label: '五个月' },
  { value: 'forever' as const, label: '永久' },
]

function Transfers() {
  const { message } = App.useApp()
  const records = useTransferStore(state => state.records)
  const progress = useTransferStore(state => state.progress)
  const retentionPeriod = useTransferStore(state => state.retentionPeriod)
  const [filter, setFilter] = useState<FilterType>('all')

  const filteredRecords = records.filter(record => {
    if (filter === 'all') return true
    return record.type === filter
  })

  const uploadingCount = records.filter(t => t.type === 'upload' && t.status === 'transferring').length
  const downloadingCount = records.filter(t => t.type === 'download' && t.status === 'transferring').length
  const pausedCount = records.filter(t => t.status === 'paused').length
  const completedCount = records.filter(t => t.status === 'completed').length
  const failedCount = records.filter(t => t.status === 'failed' || t.status === 'cancelled').length

  const getStatusTag = (status: string) => {
    const statusMap: { [key: string]: { color: string; text: string } } = {
      pending: { color: 'default', text: '等待中' },
      transferring: { color: 'processing', text: '传输中' },
      paused: { color: 'warning', text: '已暂停' },
      completed: { color: 'success', text: '已完成' },
      failed: { color: 'error', text: '失败' },
      cancelled: { color: 'default', text: '已取消' },
    }
    const { color, text } = statusMap[status] || { color: 'default', text: status }
    return <Tag color={color}>{text}</Tag>
  }

  const getTypeIcon = (type: string) => {
    return type === 'upload' ? (
      <UploadOutlined style={{ color: 'var(--color-success)', fontSize: 16 }} />
    ) : (
      <DownloadOutlined style={{ color: 'var(--color-info)', fontSize: 16 }} />
    )
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatSpeed = (bytesPerSecond: number) => {
    return formatSize(bytesPerSecond) + '/s'
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days > 0) {
      return `${days}天前`
    }
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const openFileLocation = async (localPath: string) => {
    try {
      await invoke('open_file_location', { path: localPath })
    } catch (err) {
      message.error(`打开文件位置失败: ${err}`)
    }
  }

  const removeRecord = (id: string) => {
    useTransferStore.getState().removeRecord(id)
    message.success('记录已删除')
  }

  const clearCompleted = () => {
    const completedIds = records
      .filter(t => t.status === 'completed')
      .map(t => t.id)
    for (const id of completedIds) {
      useTransferStore.getState().removeRecord(id)
    }
    message.success(`已清除 ${completedIds.length} 条已完成记录`)
  }

  const clearFailed = () => {
    const failedIds = records
      .filter(t => t.status === 'failed' || t.status === 'cancelled')
      .map(t => t.id)
    for (const id of failedIds) {
      useTransferStore.getState().removeRecord(id)
    }
    message.success(`已清除 ${failedIds.length} 条失败记录`)
  }

  const clearAll = () => {
    useTransferStore.getState().clearRecords()
    message.success('已清除所有记录')
  }

  const handleRetentionChange = (value: RetentionPeriod) => {
    useTransferStore.getState().setRetentionPeriod(value)
    message.success(`保留时间已设置为：${RETENTION_OPTIONS.find(o => o.value === value)?.label}`)
  }

  const cancelTask = async (id: string) => {
    try {
      await invoke('cancel_transfer', { taskId: id })
      useTransferStore.getState().cancelRecord(id)
      message.success('任务已取消')
    } catch (err) {
      message.error(`取消失败: ${err}`)
    }
  }

  const pauseTask = async (id: string) => {
    try {
      await invoke('pause_transfer', { taskId: id })
      useTransferStore.getState().pauseRecord(id)
      message.success('任务已暂停')
    } catch (err) {
      message.error(`暂停失败: ${err}`)
    }
  }

  const resumeTask = async (id: string) => {
    try {
      await invoke('resume_transfer', { taskId: id })
      useTransferStore.getState().resumeRecord(id)
      message.success('任务已恢复')
    } catch (err) {
      message.error(`恢复失败: ${err}`)
    }
  }

  const retryTask = async (record: typeof records[0]) => {
    const taskId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
    const now = Date.now()

    useTransferStore.getState().removeRecord(record.id)

    useTransferStore.getState().addRecord({
      ...record,
      id: taskId,
      status: 'pending',
      startTime: now,
      transferred: 0,
      error: undefined,
      endTime: undefined,
    })

    useTransferStore.getState().updateRecord(taskId, { status: 'transferring' })

    const unlistenProgress = await listen<{ transferred: number; total: number }>(
      `transfer-progress-${taskId}`,
      (event) => {
        useTransferStore.getState().updateProgress(taskId, event.payload.transferred, event.payload.total)
      }
    )

    const unlistenComplete = await listen<{ success: boolean; cancelled: boolean; error?: string }>(
      `transfer-complete-${taskId}`,
      (event) => {
        unlistenProgress()
        unlistenComplete()
        
        const result = event.payload
        if (result.cancelled) {
          useTransferStore.getState().updateRecord(taskId, { status: 'cancelled', endTime: Date.now() })
        } else if (result.success) {
          useTransferStore.getState().updateRecord(taskId, { status: 'completed', endTime: Date.now() })
          message.success(`${record.type === 'upload' ? '上传' : '下载'}完成: ${record.fileName}`)
        } else {
          useTransferStore.getState().updateRecord(taskId, {
            status: 'failed',
            error: result.error || 'Unknown error',
          })
          message.error(`${record.type === 'upload' ? '上传' : '下载'}失败: ${result.error}`)
        }
      }
    )

    try {
      if (record.type === 'upload') {
        await invoke('upload_file', {
          taskId,
          connectionId: record.connectionId,
          localPath: record.localPath,
          remotePath: record.remotePath
        })
      } else {
        await invoke('download_file', {
          taskId,
          connectionId: record.connectionId,
          remotePath: record.remotePath,
          localPath: record.localPath
        })
      }
    } catch (err) {
      unlistenProgress()
      unlistenComplete()
      useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: String(err) })
      message.error(`${record.type === 'upload' ? '上传' : '下载'}失败: ${err}`)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-container)' }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: 'var(--color-text)', fontSize: 16, fontWeight: 500 }}>传输记录</span>
          <Space size={12}>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              上传中: <span style={{ color: 'var(--color-success)' }}>{uploadingCount}</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              下载中: <span style={{ color: 'var(--color-info)' }}>{downloadingCount}</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              已暂停: <span style={{ color: 'var(--color-warning)' }}>{pausedCount}</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              已完成: <span style={{ color: 'var(--color-success)' }}>{completedCount}</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              失败: <span style={{ color: 'var(--color-error)' }}>{failedCount}</span>
            </span>
          </Space>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>保留时间:</span>
          <Select
            value={retentionPeriod}
            onChange={handleRetentionChange}
            options={RETENTION_OPTIONS}
            size="small"
            style={{ width: 100 }}
          />
        </div>
      </div>

      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Tabs
          activeKey={filter}
          onChange={(key) => setFilter(key as FilterType)}
          size="small"
          style={{ margin: 0 }}
          items={[
            {
              key: 'all',
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <SwapOutlined />
                  全部
                </span>
              ),
            },
            {
              key: 'upload',
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <UploadOutlined />
                  上传
                </span>
              ),
            },
            {
              key: 'download',
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <DownloadOutlined />
                  下载
                </span>
              ),
            },
          ]}
        />
        <Dropdown
          menu={{
            items: [
              { key: 'clearCompleted', label: '清除已完成', onClick: clearCompleted },
              { key: 'clearFailed', label: '清除失败', onClick: clearFailed },
              { key: 'clearAll', label: '清除全部', danger: true, onClick: clearAll },
            ]
          }}
        >
          <Button
            size="small"
            icon={<FilterOutlined />}
            style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}
          >
            清除
          </Button>
        </Dropdown>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {filteredRecords.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: 'var(--color-text-quaternary)' }}>暂无传输记录</span>}
            style={{ marginTop: 80 }}
          />
        ) : (
          <List
            dataSource={filteredRecords}
            renderItem={(record) => (
              <List.Item
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer',
                }}
                actions={[
                  record.status === 'transferring' ? (
                    <Tooltip key={`pause-${record.id}`} title="暂停任务">
                      <Button
                        size="small"
                        type="link"
                        icon={<PauseOutlined />}
                        style={{ color: 'var(--color-warning)', padding: 0 }}
                        onClick={() => pauseTask(record.id)}
                      >
                        暂停
                      </Button>
                    </Tooltip>
                  ) : null,
                  record.status === 'paused' ? (
                    <Tooltip key={`resume-${record.id}`} title="恢复任务">
                      <Button
                        size="small"
                        type="link"
                        icon={<CaretRightOutlined />}
                        style={{ color: 'var(--color-success)', padding: 0 }}
                        onClick={() => resumeTask(record.id)}
                      >
                        恢复
                      </Button>
                    </Tooltip>
                  ) : null,
                  (record.status === 'transferring' || record.status === 'paused') ? (
                    <Tooltip key={`cancel-${record.id}`} title="取消任务">
                      <Button
                        size="small"
                        type="link"
                        icon={<CloseCircleOutlined />}
                        style={{ color: 'var(--color-error)', padding: 0 }}
                        onClick={() => cancelTask(record.id)}
                      >
                        取消
                      </Button>
                    </Tooltip>
                  ) : null,
                  (record.status === 'failed' || record.status === 'cancelled') ? (
                    <Tooltip key={`retry-${record.id}`} title="重试任务">
                      <Button
                        size="small"
                        type="link"
                        icon={<ReloadOutlined />}
                        style={{ color: 'var(--color-info)', padding: 0 }}
                        onClick={() => retryTask(record)}
                      >
                        重试
                      </Button>
                    </Tooltip>
                  ) : null,
                  record.status === 'completed' && record.type === 'download' ? (
                    <Button
                      key={`open-${record.id}`}
                      size="small"
                      type="link"
                      style={{ color: 'var(--color-success)', padding: 0 }}
                      onClick={() => openFileLocation(record.localPath)}
                    >
                      打开位置
                    </Button>
                  ) : null,
                  <Button
                    key={`delete-${record.id}`}
                    size="small"
                    type="link"
                    danger
                    style={{ padding: 0 }}
                    onClick={() => removeRecord(record.id)}
                  >
                    删除
                  </Button>
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={getTypeIcon(record.type)}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--color-text)', fontSize: 14 }}>{record.fileName}</span>
                      {getStatusTag(record.status)}
                    </div>
                  }
                  description={
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                        <span style={{ color: 'var(--color-text-quaternary)' }}>{record.connectionName}</span>
                        <span>@</span>
                        <span>{record.connectionHost}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                        {record.type === 'upload' ? (
                          <>本地: {record.localPath}</>
                        ) : (
                          <>远程: {record.remotePath}</>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                        {record.type === 'upload' ? (
                          <>远程: {record.remotePath}</>
                        ) : (
                          <>本地: {record.localPath}</>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                        <span>{formatTime(record.startTime)}</span>
                        <span>{formatSize(record.fileSize || record.transferred)}</span>
                      </div>
                      {record.status === 'transferring' && (
                        <div style={{ marginTop: 8 }}>
                          <Progress
                            percent={(() => {
                              const p = progress[record.id]
                              if (p && p.fileSize > 0) {
                                return Math.round((p.transferred / p.fileSize) * 100)
                              }
                              return 0
                            })()}
                            size="small"
                            strokeColor={record.type === 'upload' ? 'var(--color-success)' : 'var(--color-info)'}
                            format={() => {
                              const p = progress[record.id]
                              const speed = p?.speed ? ` ${formatSpeed(p.speed)}` : ''
                              const fileCount = p?.totalFiles && p.totalFiles > 1 
                                ? ` (${p.completedFiles || 0}/${p.totalFiles} 文件)` 
                                : ''
                              return (
                                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                                  {formatSize(p?.transferred || 0)} / {formatSize(p?.fileSize || 0)}{speed}{fileCount}
                                </span>
                              )
                            }}
                          />
                        </div>
                      )}
                      {record.status === 'failed' && record.error && (
                        <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4 }}>
                          错误: {record.error}
                        </div>
                      )}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  )
}

export default Transfers