import { useState } from 'react'
import {
  List, Button, Tag, Progress, Empty, Tooltip, Badge, Tabs, Dropdown, message
} from 'antd'
import {
  FolderOpenOutlined, DeleteOutlined, CloseCircleOutlined,
  DownloadOutlined, UploadOutlined, SwapOutlined, ArrowRightOutlined
} from '@ant-design/icons'
import { open } from '@tauri-apps/plugin-shell'
import { useTerminalStore, TransferTask, TransferType, TransferStatus } from '../stores/terminalStore'

interface TransferManagerPanelProps {
  connectionId: string
  visible: boolean
  onClose: () => void
}

type FilterType = 'all' | 'upload' | 'download'

export default function TransferManagerPanel({ connectionId, visible, onClose }: TransferManagerPanelProps) {
  const store = useTerminalStore()
  const tasks = store.transferTasks[connectionId] || []
  const [filter, setFilter] = useState<FilterType>('all')

  // 过滤任务
  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true
    return task.type === filter
  })

  // 统计
  const uploadingCount = tasks.filter(t => t.type === 'upload' && t.status === 'transferring').length
  const downloadingCount = tasks.filter(t => t.type === 'download' && t.status === 'transferring').length
  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const failedCount = tasks.filter(t => t.status === 'failed').length

  // 获取状态标签
  const getStatusTag = (status: TransferStatus) => {
    const statusMap: { [key in TransferStatus]: { color: string; text: string } } = {
      pending: { color: 'default', text: '等待中' },
      transferring: { color: 'processing', text: '传输中' },
      completed: { color: 'success', text: '已完成' },
      failed: { color: 'error', text: '失败' },
      cancelled: { color: 'default', text: '已取消' },
    }
    const { color, text } = statusMap[status]
    return <Tag color={color}>{text}</Tag>
  }

  // 获取类型图标
  const getTypeIcon = (type: TransferType) => {
    return type === 'upload' ? (
      <UploadOutlined style={{ color: '#00b96b' }} />
    ) : (
      <DownloadOutlined style={{ color: '#1890ff' }} />
    )
  }

  // 格式化大小
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  // 计算传输速度
  const getSpeed = (task: TransferTask) => {
    if (task.status !== 'transferring' || task.transferred === 0) return ''
    const elapsed = (Date.now() - task.startTime) / 1000
    const speed = task.transferred / elapsed
    return formatSize(speed) + '/s'
  }

  // 打开文件所在位置
  const openFileLocation = async (localPath: string) => {
    try {
      const dir = localPath.substring(0, localPath.lastIndexOf('/')) || localPath
      await open(`file://${dir}`)
    } catch (err) {
      message.error(`打开文件夹失败: ${err}`)
    }
  }

  // 取消任务
  const cancelTask = (taskId: string) => {
    store.updateTransferTask(connectionId, taskId, { status: 'cancelled' })
  }

  // 移除任务
  const removeTask = (taskId: string) => {
    store.removeTransferTask(connectionId, taskId)
  }

  // 清除已完成任务
  const clearCompleted = () => {
    const completedIds = tasks
      .filter(t => t.status === 'completed' || t.status === 'cancelled')
      .map(t => t.id)
    for (const id of completedIds) {
      store.removeTransferTask(connectionId, id)
    }
  }

  const clearFailed = () => {
    const failedIds = tasks
      .filter(t => t.status === 'failed')
      .map(t => t.id)
    for (const id of failedIds) {
      store.removeTransferTask(connectionId, id)
    }
  }

  // 清除所有任务
  const clearAll = () => {
    store.clearTransferTasks(connectionId)
  }

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 32,
        width: 400,
        background: '#252526',
        borderLeft: '1px solid #3F3F46',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.3)',
      }}
    >
      {/* 头部 */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #3F3F46',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#CCC', fontSize: 14, fontWeight: 500 }}>传输管理</span>
          <Badge count={uploadingCount} style={{ backgroundColor: '#00b96b' }} />
          <Badge count={downloadingCount} style={{ backgroundColor: '#1890ff' }} />
        </div>
        <Button
          size="small"
          icon={<ArrowRightOutlined />}
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#999' }}
        />
      </div>

      {/* 统计栏 */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid #3F3F46',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <span style={{ fontSize: 12, color: '#888' }}>
          等待: <span style={{ color: '#faad14' }}>{pendingCount}</span>
        </span>
        <span style={{ fontSize: 12, color: '#888' }}>
          完成: <span style={{ color: '#52c41a' }}>{completedCount}</span>
        </span>
        <span style={{ fontSize: 12, color: '#888' }}>
          失败: <span style={{ color: '#ff4d4f' }}>{failedCount}</span>
        </span>
        <div style={{ flex: 1 }} />
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
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          >
            清除
          </Button>
        </Dropdown>
      </div>

      {/* 过滤标签 */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid #3F3F46',
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
      </div>

      {/* 任务列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {filteredTasks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: '#666' }}>暂无传输任务</span>}
            style={{ marginTop: 60 }}
          />
        ) : (
          <List
            dataSource={filteredTasks}
            renderItem={(task) => (
              <List.Item
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #3F3F46',
                  cursor: 'pointer',
                }}
              actions={[
                task.status === 'transferring' ? (
                  <Tooltip title="取消" key={`cancel-${task.id}`}>
                    <Button
                      size="small"
                      icon={<CloseCircleOutlined />}
                      onClick={() => cancelTask(task.id)}
                      style={{ background: 'transparent', border: 'none', color: '#ff4d4f' }}
                    />
                  </Tooltip>
                ) : null,
                task.status === 'completed' && task.type === 'download' ? (
                  <Tooltip title="打开所在位置" key={`open-${task.id}`}>
                    <Button
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={() => openFileLocation(task.localPath)}
                      style={{ background: 'transparent', border: 'none', color: '#999' }}
                    />
                  </Tooltip>
                ) : null,
                <Tooltip title="删除记录" key={`delete-${task.id}`}>
                  <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeTask(task.id)}
                    style={{ background: 'transparent', border: 'none', color: '#999' }}
                  />
                </Tooltip>,
              ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={getTypeIcon(task.type)}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#CCC', fontSize: 13 }}>{task.fileName}</span>
                      {getStatusTag(task.status)}
                    </div>
                  }
                  description={
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {task.type === 'upload' ? '➜ ' + task.remotePath : task.remotePath}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        {formatTime(task.startTime)}
                        {task.endTime && ` - ${formatTime(task.endTime)}`}
                      </div>
                      {task.status === 'transferring' && (
                        <div style={{ marginTop: 8 }}>
                          <Progress
                            percent={task.fileSize > 0 ? Math.round((task.transferred / task.fileSize) * 100) : 0}
                            size="small"
                            strokeColor={task.type === 'upload' ? '#00b96b' : '#1890ff'}
                            format={() => (
                              <span style={{ fontSize: 11, color: '#888' }}>
                                {formatSize(task.transferred)} / {formatSize(task.fileSize)}
                                {getSpeed(task) && ` (${getSpeed(task)})`}
                              </span>
                            )}
                          />
                        </div>
                      )}
                      {task.status === 'completed' && (
                        <div style={{ fontSize: 11, color: '#52c41a', marginTop: 4 }}>
                          传输完成 · {formatSize(task.fileSize || task.transferred)}
                        </div>
                      )}
                      {task.status === 'failed' && task.error && (
                        <div style={{ fontSize: 11, color: '#ff4d4f', marginTop: 4 }}>
                          错误: {task.error}
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
