import { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Button, Input, Space, Tag, Modal, Form, Select, Typography, App, Upload } from 'antd'
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, KeyOutlined, CopyOutlined, ImportOutlined, LoadingOutlined, ExportOutlined, UploadOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useTerminalStore, Connection } from '../stores/terminalStore'
import { PORT_CHECK_CONFIG } from '../config/constants'
import { generateUniqueId } from '../types/shared'
import { 
  initDatabase, 
  getConnections, 
  saveConnection, 
  deleteConnection as deleteConnectionFromDb,
  migrateFromLocalStorage,
  exportConnections,
  importConnections,
  downloadExportFile,
  readImportFile,
  recordConnectionHistory,
  getRecentConnections
} from '../services/database'

type TestResult = 'success' | 'failed' | null

function Connections() {
  const navigate = useNavigate()
  const location = useLocation()
  const { modal, message } = App.useApp()
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null)
  const [form] = Form.useForm()
  const [selectedGroup, setSelectedGroup] = useState<string>('全部')
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<TestResult>(null)
  const [testMessage, setTestMessage] = useState('')
  const [isQuickImportOpen, setIsQuickImportOpen] = useState(false)
  const [quickImportText, setQuickImportText] = useState('')
  const [quickImportGroup, setQuickImportGroup] = useState<string>('默认')
  const [recentConnections, setRecentConnections] = useState<Connection[]>([])
  
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const addConnection = useTerminalStore(state => state.addConnection)

  // 使用 ref 存储最新值，避免 useEffect 依赖变化导致频繁重建
  const connectionsRef = useRef(connections)
  const connectedRef = useRef(connectedConnections)
  const checkingRef = useRef(false) // 防止并发检测

  // 同步最新值到 ref
  useEffect(() => {
    connectionsRef.current = connections
  }, [connections])

  useEffect(() => {
    connectedRef.current = connectedConnections
  }, [connectedConnections])

  // 初始化数据库并加载数据
  useEffect(() => {
    const loadData = async () => {
      try {
        await initDatabase()
        
        // 尝试迁移 localStorage 数据
        const migrated = await migrateFromLocalStorage()
        if (migrated > 0) {
          message.success(`已迁移 ${migrated} 个连接到本地数据库`)
        }
        
        // 从数据库加载连接
        const conns = await getConnections()
        setConnections(conns)
        
        // 加载最近连接
        const recent = await getRecentConnections(5)
        setRecentConnections(recent)
      } catch (error) {
        console.error('[Connections] Failed to load data:', error)
        message.error('加载数据失败')
      } finally {
        setLoading(false)
      }
    }
    
    loadData()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const group = params.get('group')
    if (group) {
      setSelectedGroup(group)
    } else {
      setSelectedGroup('全部')
    }
  }, [location.search])


  // 端口探测 - 检测服务器在线状态（完全异步，不阻塞）
  // 优化：只在页面可见时检测，跳过已连接和正在连接的
  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const checkAllConnections = async () => {
      // 页面不可见时跳过检测
      if (document.hidden) return

      // 防止并发检测
      if (checkingRef.current) return
      checkingRef.current = true

      const conns = connectionsRef.current
      const connected = connectedRef.current

      // 过滤出需要检测的连接（跳过已连接的和正在连接中的）
      const toCheck = conns.filter(
        conn => !connected.some(c => c.connectionId === conn.id)
          && conn.status !== 'connecting'
      )

      if (toCheck.length === 0) {
        checkingRef.current = false
        return
      }

      // 并行检测所有连接
      const results = await Promise.all(
        toCheck.map(async conn => {
          try {
            const reachable = await invoke<boolean>('check_port_reachable', {
              host: conn.host,
              port: conn.port
            })
            return { id: conn.id, status: reachable ? 'online' : 'offline' } as const
          } catch (error) {
            console.error('[PortCheck] Failed:', conn.id, conn.host, error)
            return { id: conn.id, status: 'offline' } as const
          }
        })
      )

      // 批量更新状态（仅当状态真正变化时）
      if (!cancelled && results.length > 0) {
        setConnections(prev => {
          let hasChange = false
          const next = prev.map(c => {
            const result = results.find(r => r.id === c.id)
            if (result && result.status !== c.status) {
              hasChange = true
              return { ...c, status: result.status }
            }
            return c
          })
          return hasChange ? next : prev
        })
      }

      checkingRef.current = false
    }

    // 页面可见性变化时检测
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkAllConnections()
      }
    }

    // 初始检测
    checkAllConnections()

    // 使用配置的检测间隔
    intervalId = setInterval(() => {
      if (!document.hidden) {
        checkAllConnections()
      }
    }, PORT_CHECK_CONFIG.CHECK_INTERVAL)

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, []) // 空依赖数组，只在挂载时运行一次


  const filteredConnections = connections.filter(conn => {
    const matchGroup = selectedGroup === '全部' || conn.group === selectedGroup
    const matchSearch = !searchText ||
      conn.name.toLowerCase().includes(searchText.toLowerCase()) ||
      conn.host.toLowerCase().includes(searchText.toLowerCase()) ||
      conn.tags.some(tag => tag.toLowerCase().includes(searchText.toLowerCase()))
    return matchGroup && matchSearch
  })

  const handleAdd = () => {
    setEditingConnection(null)
    form.resetFields()
    form.setFieldsValue({ group: selectedGroup === '全部' ? '默认' : selectedGroup, port: 22 })
    setTestResult(null)
    setTestMessage('')
    setIsModalOpen(true)
  }

  const handleEdit = (e: React.MouseEvent, conn: Connection) => {
    e.stopPropagation()
    setEditingConnection(conn)
    form.setFieldsValue(conn)
    setTestResult(null)
    setTestMessage('')
    setIsModalOpen(true)
  }

  const handleCopyConfig = (e: React.MouseEvent, conn: Connection) => {
    e.stopPropagation()
    setEditingConnection(null)
    form.setFieldsValue({
      ...conn,
      name: `${conn.name} (副本)`
    })
    setTestResult(null)
    setTestMessage('')
    setIsModalOpen(true)
  }

  const handleQuickCopy = (e: React.MouseEvent, text: string, label: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    message.success(`已复制${label}`)
  }

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    modal.confirm({
      title: '确认删除',
      content: `确定要删除连接「${name}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteConnectionFromDb(id)
          setConnections(connections.filter(c => c.id !== id))
          message.success('连接已删除')
        } catch (error) {
          message.error(`删除失败: ${error}`)
        }
      }
    })
  }

  const handleSubmit = async (values: Partial<Connection>) => {
    const port = typeof values.port === 'string' ? parseInt(values.port, 10) || 22 : values.port || 22
    
    try {
      if (editingConnection) {
        const updated = { ...editingConnection, ...values, port }
        await saveConnection(updated)
        setConnections(connections.map(c => c.id === editingConnection.id ? updated : c))
        message.success('连接已更新')
      } else {
        const newConn: Connection = {
          id: generateUniqueId(),
          name: values.name || '',
          host: values.host || '',
          port,
          username: values.username || '',
          password: values.password,
          group: values.group || '默认',
          tags: values.tags || [],
          status: 'offline'
        }
        await saveConnection(newConn)
        setConnections([...connections, newConn])
        message.success('连接已添加')
      }
      setIsModalOpen(false)
    } catch (error) {
      message.error(`保存失败: ${error}`)
    }
  }
  const handleTestConnection = async () => {
    try {
      const values = await form.validateFields(['host', 'port', 'username', 'password', 'keyFile'])
      const port = typeof values.port === 'string' ? parseInt(values.port, 10) || 22 : values.port || 22
      
      setTestLoading(true)
      setTestResult(null)
      setTestMessage('')

      const result = await invoke<boolean>('test_connection', {
        connection: {
          host: values.host,
          port,
          username: values.username,
          password: values.password || null,
          key_file: values.keyFile || null,
        }
      })

      if (result) {
        setTestResult('success')
        setTestMessage('连接成功')
      } else {
        setTestResult('failed')
        setTestMessage('连接失败：认证失败')
      }
    } catch (error) {
      setTestResult('failed')
      setTestMessage(`连接失败：${error}`)
    } finally {
      setTestLoading(false)
    }
  }

  const isConnected = (connId: string) => {
    return connectedConnections.some(c => c.connectionId === connId)
  }

  const handleConnect = async (conn: Connection) => {
    if (isConnected(conn.id)) {
      navigate('/terminal')
      return
    }

    if (conn.status === 'connecting') return

    // 使用 flushSync 强制同步渲染，确保 UI 立即更新
    flushSync(() => {
      setConnections(prev => prev.map(c =>
        c.id === conn.id ? { ...c, status: 'connecting' as const } : c
      ))
    })
    
    message.info(`正在连接 ${conn.name}...`)

    try {
      await invoke('connect_ssh', {
        id: conn.id,
        connection: {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.password || null,
          key_file: conn.keyFile || null,
        }
      })

      const shellId = await invoke<string>('get_shell', { id: conn.id })

      setConnections(prev => prev.map(c =>
        c.id === conn.id ? { ...c, status: 'online' as const } : c
      ))

      addConnection(conn, shellId)
      
      recordConnectionHistory(conn.id).catch(console.error)

      message.success(`已连接到 ${conn.name}`)
      navigate('/terminal')
    } catch (error) {
      console.error('[Connections] Connection failed:', error)
      setConnections(prev => prev.map(c =>
        c.id === conn.id ? { ...c, status: 'offline' as const } : c
      ))
      message.error(`连接失败: ${error}`)
    }
  }


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'var(--color-success)'
      case 'connecting': return 'var(--color-info)'
      default: return 'var(--color-text-quaternary)'
    }
  }

  const groupOptions = [
    { value: '生产环境', label: '生产环境' },
    { value: '开发环境', label: '开发环境' },
    { value: '测试环境', label: '测试环境' },
    { value: '默认', label: '默认' },
  ]

  // 解析快速导入文本
  const parseQuickImportText = (text: string): Partial<Connection> | null => {
    const trimmed = text.trim()
    const result: Partial<Connection> = {}

    // 尝试解析 SSH URL 格式: ssh://user@host:port 或 user@host
    const sshUrlMatch = trimmed.match(/^ssh:\/\/([^@]+)@([^:]+)(?::(\d+))?$/)
    if (sshUrlMatch) {
      result.username = sshUrlMatch[1]
      result.host = sshUrlMatch[2]
      result.port = sshUrlMatch[3] ? parseInt(sshUrlMatch[3], 10) : 22
      result.name = result.host
      return result
    }

    // 尝试解析 user@host 格式
    const userHostMatch = trimmed.match(/^([^@]+)@([^:\s]+)(?::(\d+))?$/)
    if (userHostMatch && !trimmed.includes('\n')) {
      result.username = userHostMatch[1]
      result.host = userHostMatch[2]
      result.port = userHostMatch[3] ? parseInt(userHostMatch[3], 10) : 22
      result.name = result.host
      return result
    }

    // 尝试解析一行格式: name|host|port|user|password
    const pipeMatch = trimmed.match(/^([^|]+)\|([^|]+)\|(\d+)\|([^|]+)(?:\|(.+))?$/)
    if (pipeMatch) {
      result.name = pipeMatch[1].trim()
      result.host = pipeMatch[2].trim()
      result.port = parseInt(pipeMatch[3], 10) || 22
      result.username = pipeMatch[4].trim()
      if (pipeMatch[5]) result.password = pipeMatch[5].trim()
      return result
    }

    // 原有的键值对格式解析
    const lines = trimmed.split('\n')

    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.substring(0, colonIndex).trim()
      const value = line.substring(colonIndex + 1).trim()

      switch (key) {
        case '名称':
        case 'Name':
          result.name = value
          break
        case '地址':
        case '主机':
        case 'Host':
          result.host = value
          break
        case '端口':
        case 'Port':
          result.port = parseInt(value, 10) || 22
          break
        case '用户':
        case '用户名':
        case 'User':
        case 'Username':
          result.username = value
          break
        case '密码':
        case 'Password':
          result.password = value
          break
      }
    }

    // 验证必填字段
    if (!result.name || !result.host || !result.username) {
      return null
    }

    return result
  }

  // 快速导入保存
  const handleQuickImportSave = async (shouldConnect: boolean = false) => {
    const parsed = parseQuickImportText(quickImportText)
    
    if (!parsed) {
      message.error('格式错误，请检查输入内容')
      return
    }
    
    const newConn: Connection = {
      id: generateUniqueId(),
      name: parsed.name || '',
      host: parsed.host || '',
      port: parsed.port || 22,
      username: parsed.username || '',
      password: parsed.password,
      group: quickImportGroup,
      tags: [],
      status: 'offline'
    }
    
    try {
      await saveConnection(newConn)
      flushSync(() => {
        setConnections([...connections, newConn])
      })
      setIsQuickImportOpen(false)
      setQuickImportText('')
      setQuickImportGroup('默认')
      message.success('连接已添加')

      if (shouldConnect) {
        setTimeout(() => handleConnect(newConn), 50)
      }
    } catch (error) {
      message.error(`保存失败: ${error}`)
    }
  }

  const handleExportConnections = async () => {
    if (connections.length === 0) {
      message.warning('没有可导出的连接')
      return
    }
    
    try {
      const data = await exportConnections()
      const filename = `iterminal_connections_${new Date().toISOString().slice(0, 10)}.json`
      downloadExportFile(data, filename)
      message.success('导出成功')
    } catch (error) {
      message.error(`导出失败: ${error}`)
    }
  }

  const handleImportFile = async (file: File) => {
    try {
      const jsonData = await readImportFile(file)
      const count = await importConnections(jsonData, true)
      const conns = await getConnections()
      setConnections(conns)
      message.success(`成功导入 ${count} 个连接`)
    } catch (error) {
      message.error(`导入失败: ${error}`)
    }
    return false
  }


  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Input
          placeholder="搜索连接..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ width: 300 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新建连接
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => setIsQuickImportOpen(true)}>
          快速导入
        </Button>
        <Button icon={<ExportOutlined />} onClick={handleExportConnections}>
          导出
        </Button>
        <Upload
          accept=".json"
          showUploadList={false}
          beforeUpload={handleImportFile}
        >
          <Button icon={<UploadOutlined />}>导入文件</Button>
        </Upload>
      </div>

      {recentConnections.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ 
            fontSize: 13, 
            color: 'var(--color-text-secondary)', 
            marginBottom: 8,
            fontWeight: 500
          }}>
            最近连接
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {recentConnections.map(conn => (
              <Button
                key={conn.id}
                size="small"
                onClick={() => handleConnect(conn)}
                style={{
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)'
                }}
              >
                {conn.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
            color: 'var(--color-text-tertiary)'
          }}>
            <LoadingOutlined style={{ fontSize: 24, marginRight: 8 }} />
            加载中...
          </div>
        ) : filteredConnections.length === 0 ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
            color: 'var(--color-text-tertiary)'
          }}>
            <p style={{ marginBottom: 16 }}>暂无连接</p>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              新建连接
            </Button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {filteredConnections.map(conn => (
              <Card
                key={conn.id}
                size="small"
                hoverable={conn.status !== 'connecting'}
                style={{
                  background: 'var(--color-bg-elevated)',
                  borderColor: conn.status === 'connecting' ? 'var(--color-info)' : 'var(--color-border)',
                  cursor: 'pointer',
                  opacity: conn.status === 'connecting' ? 0.85 : 1,
                  transition: 'all 0.3s ease',
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onClick={() => conn.status !== 'connecting' && handleConnect(conn)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{conn.name}</span>
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: conn.status === 'connecting' ? 'var(--color-info)' : (isConnected(conn.id) ? 'var(--color-success)' : getStatusColor(conn.status)),
                        marginLeft: 8
                      }} />
                    </div>
                    <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                      {conn.username}@{conn.host}:{conn.port}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Tag style={{ background: 'var(--color-border)', border: 'none', color: 'var(--color-text)' }}>
                        {conn.group}
                      </Tag>
                      {conn.tags.map(tag => (
                        <Tag key={tag} style={{ background: 'var(--color-primary)', border: 'none', color: '#fff', marginLeft: 4, opacity: 0.9 }}>
                          {tag}
                        </Tag>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 12 }}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EnvironmentOutlined />}
                      onClick={(e) => handleQuickCopy(e, conn.host, 'IP')}
                      style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}
                    >
                      复制IP
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      icon={<KeyOutlined />}
                      onClick={(e) => handleQuickCopy(e, `名称: ${conn.name}\n地址: ${conn.host}\n端口: ${conn.port}\n用户: ${conn.username}\n密码: ${conn.password || '无'}`, '信息')}
                      style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}
                    >
                      复制信息
                    </Button>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={(e) => handleCopyConfig(e, conn)}
                    style={{ color: 'var(--color-success)' }}
                  >
                    复制
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={conn.status === 'connecting' ? <LoadingOutlined /> : <PlayCircleOutlined />}
                    onClick={(e) => { 
                      e.stopPropagation()
                      if (conn.status !== 'connecting') handleConnect(conn) 
                    }}
                    style={{ color: conn.status === 'connecting' ? 'var(--color-info)' : undefined }}
                  >
                    {conn.status === 'connecting' ? '连接中' : (isConnected(conn.id) ? '打开' : '连接')}
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => handleEdit(e, conn)}
                  >
                    编辑
                  </Button>
                  <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => handleDelete(e, conn.id, conn.name)}
                    >
                      删除
                    </Button>
                  </div>
                  {conn.status === 'connecting' && (
                    <div className="connecting-progress-bar" />
                  )}
                </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        title={editingConnection ? '编辑连接' : '新建连接'}
        open={isModalOpen}
        onOk={form.submit}
        onCancel={() => setIsModalOpen(false)}
        width={500}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入连接名称' }]}>
            <Input placeholder="连接名称" />
          </Form.Item>
          <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机地址' }]}>
            <Input placeholder="IP 地址或主机名" />
          </Form.Item>
          <Form.Item name="port" label="端口" initialValue={22}>
            <Input type="number" placeholder="22" />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="root" />
          </Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="密码" />
          </Form.Item>
          <Form.Item 
            name="keyFile" 
            label="密钥文件"
            extra="支持 OpenSSH 和 PEM 格式的私钥文件，如 ~/.ssh/id_rsa"
          >
            <Input 
              placeholder="选择或输入密钥文件路径" 
              addonAfter={
                <Button 
                  type="text" 
                  size="small" 
                  icon={<FolderOpenOutlined />}
                  onClick={async () => {
                    const selected = await open({
                      title: '选择 SSH 密钥文件',
                      filters: [{
                        name: 'SSH Private Key',
                        extensions: ['pem', 'key', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa']
                      }]
                    })
                    if (selected) {
                      form.setFieldValue('keyFile', selected)
                    }
                  }}
                />
              }
            />
          </Form.Item>
          <Form.Item name="group" label="分组" initialValue="默认">
            <Select options={groupOptions} />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="添加标签" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button 
                onClick={handleTestConnection}
                loading={testLoading}
              >
                测试连接
              </Button>
              {testResult && (
                <Space>
                  {testResult === 'success' ? (
                    <CheckCircleOutlined style={{ color: 'var(--color-success)', fontSize: 16 }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: 'var(--color-error)', fontSize: 16 }} />
                  )}
                  <span style={{ 
                    color: testResult === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                    fontSize: 14
                  }}>
                    {testMessage}
                  </span>
                </Space>
              )}
            </div>
          </Form.Item>
        </Form>
      </Modal>

      {/* 快速导入弹窗 */}
      <Modal
        title="快速导入"
        open={isQuickImportOpen}
        onCancel={() => {
          setIsQuickImportOpen(false)
          setQuickImportText('')
          setQuickImportGroup('默认')
        }}
        footer={null}
        width={500}
      >
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            支持格式：
          </Typography.Text>
          <div style={{
            background: 'var(--color-bg-elevated)',
            padding: 10,
            borderRadius: 4,
            marginTop: 8,
            fontSize: 11,
            color: 'var(--color-text-tertiary)',
            border: '1px solid var(--color-border)',
            lineHeight: 1.8
          }}>
            <div><span style={{ color: '#00b96b' }}>键值对:</span> 名称: xxx / 地址: xxx / 端口: 22 / 用户: xxx / 密码: xxx</div>
            <div><span style={{ color: '#1890ff' }}>SSH URL:</span> ssh://user@host:port 或 user@host</div>
            <div><span style={{ color: '#faad14' }}>一行式:</span> 名称|地址|端口|用户|密码</div>
          </div>
        </div>

        <Input.TextArea
          value={quickImportText}
          onChange={e => setQuickImportText(e.target.value)}
          placeholder="粘贴连接信息..."
          rows={8}
          style={{ marginBottom: 12 }}
        />
        
        <div style={{ marginBottom: 16 }}>
          <span style={{ marginRight: 8, color: 'var(--color-text)' }}>分组：</span>
          <Select
            value={quickImportGroup}
            onChange={setQuickImportGroup}
            options={groupOptions}
            style={{ width: 150 }}
          />
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => {
            setIsQuickImportOpen(false)
            setQuickImportText('')
            setQuickImportGroup('默认')
          }}>
            取消
          </Button>
          <Button onClick={() => handleQuickImportSave(false)}>
            保存
          </Button>
          <Button type="primary" onClick={() => handleQuickImportSave(true)}>
            保存并连接
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default Connections