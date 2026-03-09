import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Button, Input, Space, Tag, Modal, Form, Select, message } from 'antd'
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  group: string
  tags: string[]
  status: 'online' | 'offline' | 'connecting'
}

const STORAGE_KEY = 'iterminal_connections'

const defaultConnections: Connection[] = [
  { id: '1', name: 'Production Server', host: '192.168.1.100', port: 22, username: 'root', group: 'Production', tags: ['production', 'linux'], status: 'offline' },
  { id: '2', name: 'Dev Server', host: '192.168.1.101', port: 22, username: 'dev', group: 'Development', tags: ['dev', 'linux'], status: 'offline' },
  { id: '3', name: 'Database Server', host: '192.168.1.102', port: 22, username: 'admin', group: 'Production', tags: ['database', 'mysql'], status: 'offline' },
  { id: '4', name: 'Test Server', host: '192.168.1.103', port: 22, username: 'test', group: 'Testing', tags: ['test', 'linux'], status: 'offline' },
]

function Connections() {
  const navigate = useNavigate()
  const location = useLocation()
  const [connections, setConnections] = useState<Connection[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : defaultConnections
  })
  const [searchText, setSearchText] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null)
  const [form] = Form.useForm()
  // 从侧边栏选中获取当前分组
  const [selectedGroup, setSelectedGroup] = useState<string>('All')

  // 接收侧边栏传递的分组参数
  useEffect(() => {
    const state = location.state as { selectedGroup?: string } | null
    if (state?.selectedGroup) {
      setSelectedGroup(state.selectedGroup)
    }
  }, [location.state])

  // 持久化到localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
  }, [connections])

  // 根据选中分组和搜索过滤连接
  const filteredConnections = connections.filter(conn => {
    const matchGroup = selectedGroup === 'All' || conn.group === selectedGroup
    const matchSearch = !searchText ||
      conn.name.toLowerCase().includes(searchText.toLowerCase()) ||
      conn.host.toLowerCase().includes(searchText.toLowerCase()) ||
      conn.tags.some(tag => tag.toLowerCase().includes(searchText.toLowerCase()))
    return matchGroup && matchSearch
  })

  const handleAdd = () => {
    setEditingConnection(null)
    form.resetFields()
    form.setFieldsValue({ group: selectedGroup === 'All' ? 'Default' : selectedGroup, port: 22 })
    setIsModalOpen(true)
  }

  const handleEdit = (conn: Connection) => {
    setEditingConnection(conn)
    form.setFieldsValue(conn)
    setIsModalOpen(true)
  }

  const handleDelete = (id: string) => {
    setConnections(connections.filter(c => c.id !== id))
    message.success('Connection deleted')
  }

  const handleSubmit = (values: Partial<Connection>) => {
    if (editingConnection) {
      setConnections(connections.map(c => c.id === editingConnection.id ? { ...c, ...values } : c))
      message.success('Connection updated')
    } else {
      const newConn: Connection = {
        id: Date.now().toString(),
        name: values.name || '',
        host: values.host || '',
        port: values.port || 22,
        username: values.username || '',
        password: values.password,
        group: values.group || 'Default',
        tags: values.tags || [],
        status: 'offline'
      }
      setConnections([...connections, newConn])
      message.success('Connection added')
    }
    setIsModalOpen(false)
  }

  const handleConnect = async (conn: Connection) => {
    if (conn.status === 'connecting') return

    setConnections(connections.map(c =>
      c.id === conn.id ? { ...c, status: 'connecting' as const } : c
    ))
    message.info(`Connecting to ${conn.name}...`)

    try {
      console.log('[Connections] Connecting to SSH:', conn.id)

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

      console.log('[Connections] SSH connected successfully')

      setConnections(connections.map(c =>
        c.id === conn.id ? { ...c, status: 'online' as const } : c
      ))
      message.success(`Connected to ${conn.name}`)

      console.log('[Connections] Navigating to terminal with state:', { connectionId: conn.id })
      navigate('/terminal', { state: { connectionId: conn.id, connection: conn } })
    } catch (error) {
      console.error('[Connections] Connection failed:', error)
      setConnections(connections.map(c =>
        c.id === conn.id ? { ...c, status: 'offline' as const } : c
      ))
      message.error(`Failed to connect: ${error}`)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#4EC9B0'
      case 'connecting': return '#007ACC'
      default: return '#999999'
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部搜索和按钮 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Input
          placeholder="Search connections..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ width: 300 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          New Connection
        </Button>
      </div>

      {/* 连接卡片列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
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
              <Card.Meta
                title={
                  <Space>
                    <span style={{ color: '#CCCCCC' }}>{conn.name}</span>
                    <span style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: getStatusColor(conn.status)
                    }} />
                  </Space>
                }
                description={
                  <div style={{ color: '#999999', fontSize: 12 }}>
                    <div>{conn.username}@{conn.host}:{conn.port}</div>
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
                }
              />
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button
                  type="text"
                  size="small"
                  icon={<PlayCircleOutlined />}
                  onClick={(e) => { e.stopPropagation(); handleConnect(conn) }}
                >
                  Connect
                </Button>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => { e.stopPropagation(); handleEdit(conn) }}
                >
                  Edit
                </Button>
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => { e.stopPropagation(); handleDelete(conn.id) }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* 新建/编辑连接弹窗 */}
      <Modal
        title={editingConnection ? 'Edit Connection' : 'New Connection'}
        open={isModalOpen}
        onOk={form.submit}
        onCancel={() => setIsModalOpen(false)}
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="Connection name" />
          </Form.Item>
          <Form.Item name="host" label="Host" rules={[{ required: true }]}>
            <Input placeholder="IP address or hostname" />
          </Form.Item>
          <Form.Item name="port" label="Port" initialValue={22}>
            <Input type="number" placeholder="22" />
          </Form.Item>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input placeholder="root" />
          </Form.Item>
          <Form.Item name="password" label="Password">
            <Input.Password placeholder="Password" />
          </Form.Item>
          <Form.Item name="group" label="Group" initialValue="Default">
            <Select>
              <Select.Option value="Production">Production</Select.Option>
              <Select.Option value="Development">Development</Select.Option>
              <Select.Option value="Testing">Testing</Select.Option>
              <Select.Option value="Default">Default</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="tags" label="Tags">
            <Select mode="tags" placeholder="Add tags" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Connections