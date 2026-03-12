import { useState } from 'react'
import { List, Button, Tag, Empty, Select, Tabs, Dropdown, message, Space, Progress } from 'antd'
import {
  DownloadOutlined, UploadOutlined, SwapOutlined, FilterOutlined
} from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import { useTransferStore, RetentionPeriod } from '../stores/transferStore'

type FilterType = 'all' | 'upload' | 'download'

const RETENTION_OPTIONS = [
  { value: '1month' as const, label: '一个月' },
  { value: '3months' as const, label: '三个月' },
  { value: '5months' as const, label: '五个月' },
  { value: 'forever' as const, label: '永久' },
]

function Transfers() {
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
  const completedCount = records.filter(t => t.status === 'completed').length
  const failedCount = records.filter(t => t.status === 'failed' || t.status === 'cancelled').length

  const getStatusTag = (status: string) => {
    const statusMap: { [key: string]: { color: string; text: string } } = {
      pending: { color: 'default', text: '等待中' },
      transferring: { color: 'processing', text: '传输中' },
      completed: { color: 'success', text: '已完成' },
      failed: { color: 'error', text: '失败' },
      cancelled: { color: 'default', text: '已取消' },
    }
    const { color, text } = statusMap[status] || { color: 'default', text: status }
    return <Tag color={color}>{text}</Tag>
  }

  const getTypeIcon = (type: string) => {
    return type === 'upload' ? (
      <UploadOutlined style={{ color: '#00b96b', fontSize: 16 }} />
    ) : (
      <DownloadOutlined style={{ color: '#1890ff', fontSize: 16 }} />
    )
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
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
      const dir = localPath.substring(0, localPath.lastIndexOf('/')) || localPath
      await invoke('open_folder', { path: dir })
    } catch (err) {
      message.error(`打开文件夹失败: ${err}`)
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1E1E1E' }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #3F3F46',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: '#CCC', fontSize: 16, fontWeight: 500 }}>传输记录</span>
          <Space size={12}>
            <span style={{ fontSize: 12, color: '#888' }}>
              上传中: <span style={{ color: '#00b96b' }}>{uploadingCount}</span>
            </span>
            <span style={{ fontSize: 12, color: '#888' }}>
              下载中: <span style={{ color: '#1890ff' }}>{downloadingCount}</span>
            </span>
            <span style={{ fontSize: 12, color: '#888' }}>
              已完成: <span style={{ color: '#52c41a' }}>{completedCount}</span>
            </span>
            <span style={{ fontSize: 12, color: '#888' }}>
              失败: <span style={{ color: '#ff4d4f' }}>{failedCount}</span>
            </span>
          </Space>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#888' }}>保留时间:</span>
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
        borderBottom: '1px solid #3F3F46',
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
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          >
            清除
          </Button>
        </Dropdown>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {filteredRecords.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: '#666' }}>暂无传输记录</span>}
            style={{ marginTop: 80 }}
          />
        ) : (
          <List
            dataSource={filteredRecords}
            renderItem={(record) => (
              <List.Item
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #3F3F46',
                  cursor: 'pointer',
                }}
                actions={[
                  record.status === 'completed' && record.type === 'download' ? (
                    <Button
                      key={`open-${record.id}`}
                      size="small"
                      type="link"
                      style={{ color: '#00b96b', padding: 0 }}
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
                      <span style={{ color: '#CCC', fontSize: 14 }}>{record.fileName}</span>
                      {getStatusTag(record.status)}
                    </div>
                  }
                  description={
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888' }}>
                        <span style={{ color: '#666' }}>{record.connectionName}</span>
                        <span>@</span>
                        <span>{record.connectionHost}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                        {record.type === 'upload' ? '➜ ' : '➜ '}
                        {record.remotePath}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#888', marginTop: 4 }}>
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
                            strokeColor={record.type === 'upload' ? '#00b96b' : '#1890ff'}
                            format={() => {
                              const p = progress[record.id]
                              return (
                                <span style={{ fontSize: 11, color: '#888' }}>
                                  {formatSize(p?.transferred || 0)} / {formatSize(p?.fileSize || 0)}
                                </span>
                              )
                            }}
                          />
                        </div>
                      )}
                      {record.status === 'failed' && record.error && (
                        <div style={{ fontSize: 11, color: '#ff4d4f', marginTop: 4 }}>
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