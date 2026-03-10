import { useState } from 'react'
import { Table, Breadcrumb, Button, Space, message } from 'antd'
import { FolderOutlined, FileOutlined, UploadOutlined, DownloadOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

interface FileItem {
  key: string
  name: string
  isDirectory: boolean
  size: number
  modifiedTime: string
}

const mockLocalFiles: FileItem[] = [
  { key: '1', name: 'Documents', isDirectory: true, size: 0, modifiedTime: '2026-03-01' },
  { key: '2', name: 'Downloads', isDirectory: true, size: 0, modifiedTime: '2026-03-02' },
  { key: '3', name: 'project.zip', isDirectory: false, size: 1024000, modifiedTime: '2026-03-05' },
]

const mockRemoteFiles: FileItem[] = [
  { key: '1', name: '/home', isDirectory: true, size: 0, modifiedTime: '2026-03-01' },
  { key: '2', name: '/var', isDirectory: true, size: 0, modifiedTime: '2026-02-28' },
  { key: '3', name: 'app.log', isDirectory: false, size: 524288, modifiedTime: '2026-03-06' },
]

function FileManager() {
  const [localFiles] = useState<FileItem[]>(mockLocalFiles)
  const [remoteFiles] = useState<FileItem[]>(mockRemoteFiles)
  const [localPath] = useState('/Users/itophua')
  const [remotePath] = useState('/home')

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const columns: ColumnsType<FileItem> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Space>
          {record.isDirectory ? <FolderOutlined style={{ color: '#faad14' }} /> : <FileOutlined />}
          {text}
        </Space>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      render: (size) => formatSize(size),
    },
    {
      title: '修改时间',
      dataIndex: 'modifiedTime',
      key: 'modifiedTime',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space>
          {!record.isDirectory && (
            <>
              <Button size="small" icon={<UploadOutlined />} onClick={() => message.info('上传: ' + record.name)} />
              <Button size="small" icon={<DownloadOutlined />} onClick={() => message.info('下载: ' + record.name)} />
            </>
          )}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => message.info('删除: ' + record.name)} />
        </Space>
      ),
    },
  ]

  return (
    <div style={{ height: 'calc(100vh - 200px)' }}>
      <div style={{ display: 'flex', gap: 16, height: '100%' }}>
        <div style={{ flex: 1, background: '#1f1f1f', padding: 16, borderRadius: 8 }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Breadcrumb
              items={[{ title: '本地' }, { title: localPath }]}
            />
            <Space>
              <Button icon={<UploadOutlined />}>上传</Button>
            </Space>
          </div>
          <Table
            columns={columns}
            dataSource={localFiles}
            pagination={false}
            size="small"
          />
        </div>
        <div style={{ flex: 1, background: '#1f1f1f', padding: 16, borderRadius: 8 }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Breadcrumb
              items={[{ title: '远程' }, { title: remotePath }]}
            />
            <Space>
              <Button icon={<DownloadOutlined />}>下载</Button>
            </Space>
          </div>
          <Table
            columns={columns}
            dataSource={remoteFiles}
            pagination={false}
            size="small"
          />
        </div>
      </div>
    </div>
  )
}

export default FileManager