import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Button, Input, Space, Tag, Modal, Form, Select, message, Typography } from 'antd'
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, KeyOutlined, CopyOutlined, ImportOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import { useTerminalStore, Connection } from '../stores/terminalStore'

const STORAGE_KEY = 'iterminal_connections'

type TestResult = 'success' | 'failed' | null

function Connections() {
  const navigate = useNavigate()
  const location = useLocation()
  const [connections, setConnections] = useState<Connection[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    // 启动时重置所有连接状态为 offline
    return parsed.map((conn: Connection) => ({ ...conn, status: 'offline' as const }))
  })
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
  
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const addConnection = useTerminalStore(state => state.addConnection)

  useEffect(() => {
    const state = location.state as { selectedGroup?: string } | null
    if (state?.selectedGroup) {
      setSelectedGroup(state.selectedGroup)
    }
  }, [location.state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
    // 触发分组刷新事件
    window.dispatchEvent(new CustomEvent('connections-updated'))
  }, [connections])


  // 端口探测 - 检测服务器在线状态（完全异步，不阻塞）
  useEffect(() => {
    let cancelled = false
    
    const checkAllConnections = async (conns: Connection[], connected: typeof connectedConnections) => {
      // 过滤出需要检测的连接（跳过已连接的和正在连接中的）
      const toCheck = conns.filter(
        conn => !connected.some(c => c.connectionId === conn.id)
          && conn.status !== 'connecting'
      )
      
      if (toCheck.length === 0) return
      
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
      
      // 批量更新状态
      if (!cancelled && results.length > 0) {
        setConnections(prev => prev.map(c => {
          const result = results.find(r => r.id === c.id)
          return result ? { ...c, status: result.status } : c
        }))
      }
    }
    
    // 启动时延迟 3 秒再检测，让应用先完成初始化
    const initialTimeout = setTimeout(() => {
      checkAllConnections(connections, connectedConnections)
    }, 3000)
    
    // 每 1 分钟检测一次
    const interval = setInterval(() => {
      // 直接使用当前的 connections 和 connectedConnections
      // 注意：由于依赖数组包含这些值，effect 会重新运行，interval 也会重建
      checkAllConnections(connections, connectedConnections)
    }, 60000)
    
    return () => {
      cancelled = true
      clearTimeout(initialTimeout)
      clearInterval(interval)
    }
  }, [connections, connectedConnections])


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

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setConnections(connections.filter(c => c.id !== id))
    message.success('连接已删除')
  }

  const handleSubmit = (values: Partial<Connection>) => {
    const port = typeof values.port === 'string' ? parseInt(values.port, 10) || 22 : values.port || 22
    
    if (editingConnection) {
      setConnections(connections.map(c => c.id === editingConnection.id ? { ...c, ...values, port } : c))
      message.success('连接已更新')
    } else {
      const newConn: Connection = {
        id: Date.now().toString(),
        name: values.name || '',
        host: values.host || '',
        port,
        username: values.username || '',
        password: values.password,
        group: values.group || '默认',
        tags: values.tags || [],
        status: 'offline'
      }
      setConnections([...connections, newConn])
      message.success('连接已添加')
    }
    setIsModalOpen(false)
  }
  const handleTestConnection = async () => {
    try {
      const values = await form.validateFields(['host', 'port', 'username', 'password'])
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
          keyFile: null,
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

    // 使用函数式更新，确保使用最新状态
    setConnections(prev => prev.map(c =>
      c.id === conn.id ? { ...c, status: 'connecting' as const } : c
    ))
    message.info(`正在连接 ${conn.name}...`)

    try {
      await invoke('connect_ssh', {
        id: conn.id,
        connection: {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.password || null,
          keyFile: null,
        }
      })

      const shellId = await invoke<string>('get_shell', { id: conn.id })

      setConnections(prev => prev.map(c =>
        c.id === conn.id ? { ...c, status: 'online' as const } : c
      ))

      addConnection(conn, shellId)

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
      case 'online': return '#52c41a' // 更鲜艳的绿色
      case 'connecting': return '#007ACC'
      default: return '#999999'
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
    const lines = text.trim().split('\n')
    const result: Partial<Connection> = {}
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue
      
      const key = line.substring(0, colonIndex).trim()
      const value = line.substring(colonIndex + 1).trim()
      
      switch (key) {
        case '名称':
          result.name = value
          break
        case '地址':
        case '主机':
          result.host = value
          break
        case '端口':
          result.port = parseInt(value, 10) || 22
          break
        case '用户':
        case '用户名':
          result.username = value
          break
        case '密码':
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
  const handleQuickImportSave = (shouldConnect: boolean = false) => {
    const parsed = parseQuickImportText(quickImportText)
    
    if (!parsed) {
      message.error('格式错误，请检查输入内容')
      return
    }
    
    const newConn: Connection = {
      id: Date.now().toString(),
      name: parsed.name || '',
      host: parsed.host || '',
      port: parsed.port || 22,
      username: parsed.username || '',
      password: parsed.password,
      group: '默认',
      tags: [],
      status: 'offline'
    }
    
    setConnections([...connections, newConn])
    setIsQuickImportOpen(false)
    setQuickImportText('')
    message.success('连接已添加')
    
    if (shouldConnect) {
      // 延迟执行，确保状态已更新到 localStorage
      setTimeout(() => handleConnect(newConn), 100)
    }
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
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredConnections.length === 0 ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
            color: '#999999'
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
                hoverable
                style={{
                  background: '#2D2D30',
                  borderColor: '#3F3F46',
                  cursor: 'pointer'
                }}
                onClick={() => handleConnect(conn)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ color: '#CCCCCC', fontWeight: 500 }}>{conn.name}</span>
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isConnected(conn.id) ? '#52c41a' : getStatusColor(conn.status),
                        marginLeft: 8
                      }} />
                    </div>
                    <div style={{ color: '#999999', fontSize: 12 }}>
                      {conn.username}@{conn.host}:{conn.port}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Tag style={{ background: '#3F3F46', border: 'none', color: '#CCCCCC' }}>
                        {conn.group}
                      </Tag>
                      {conn.tags.map(tag => (
                        <Tag key={tag} style={{ background: '#094771', border: 'none', color: '#4EC9B0', marginLeft: 4 }}>
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
                      style={{ color: '#999', fontSize: 12 }}
                    >
                      复制IP
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      icon={<KeyOutlined />}
                      onClick={(e) => handleQuickCopy(e, `名称: ${conn.name}\n地址: ${conn.host}\n端口: ${conn.port}\n用户: ${conn.username}\n密码: ${conn.password || '无'}`, '信息')}
                      style={{ color: '#999', fontSize: 12 }}
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
                    style={{ color: '#52c41a' }}
                  >
                    复制
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={(e) => { e.stopPropagation(); handleConnect(conn) }}
                  >
                    {isConnected(conn.id) ? '打开' : '连接'}
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
                    onClick={(e) => handleDelete(e, conn.id)}
                  >
                    删除
                  </Button>
                </div>
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
                    <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                  )}
                  <span style={{ 
                    color: testResult === 'success' ? '#52c41a' : '#ff4d4f',
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
        }}
        footer={null}
        width={500}
      >
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            请按以下格式粘贴连接信息：
          </Typography.Text>
          <pre style={{ 
            background: '#2D2D30', 
            padding: 12, 
            borderRadius: 4, 
            marginTop: 8, 
            fontSize: 12, 
            color: '#CCCCCC',
            border: '1px solid #3F3F46'
          }}>
{`名称: test
地址: 127.0.0.1
端口: 22
用户: test
密码: test`}
          </pre>
        </div>

        <Input.TextArea
          value={quickImportText}
          onChange={e => setQuickImportText(e.target.value)}
          placeholder="粘贴连接信息..."
          rows={8}
          style={{ marginBottom: 16 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => {
            setIsQuickImportOpen(false)
            setQuickImportText('')
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