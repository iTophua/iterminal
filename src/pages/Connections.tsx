import { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Card, Button, Input, Space, Tag, Modal, Form, Select, Typography, App, Upload, Checkbox, Row, Col, Radio } from 'antd'
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, KeyOutlined, CopyOutlined, ImportOutlined, LoadingOutlined, ExportOutlined, UploadOutlined, FolderOpenOutlined, SwapOutlined, CheckSquareOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useTerminalStore, Connection } from '../stores/terminalStore'
import { useHistoryStore } from '../stores/historyStore'
import { PORT_CHECK_CONFIG } from '../config/constants'
import { generateUniqueId } from '../types/shared'
import { 
  initDatabase, 
  getConnections, 
  saveConnection, 
  deleteConnection as deleteConnectionFromDb,
  migrateFromLocalStorage,
  importConnections,
  readImportFile,
  recordConnectionHistory,
  getRecentConnections,
  updateConnectionOrder
} from '../services/database'
import { writeTextFile } from '@tauri-apps/plugin-fs'

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
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([])
  const [exportAll, setExportAll] = useState(true)
  const [authType, setAuthType] = useState<'password' | 'key'>('password')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchGroup, setBatchGroup] = useState<string>('')
  const [isBatchGroupModalOpen, setIsBatchGroupModalOpen] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null)
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isReorderMode, setIsReorderMode] = useState(false)
  const clearConnectionHistory = useHistoryStore(state => state.clearConnectionHistory)
  const [isDraggingActive, setIsDraggingActive] = useState(false)
  const draggedConnection = draggedId ? connections.find(c => c.id === draggedId) : null
  
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

  const refreshRecentConnections = async () => {
    try {
      const recent = await getRecentConnections(6)
      setRecentConnections(recent)
    } catch (error) {
      console.error('[Connections] Failed to refresh recent connections:', error)
    }
  }

  // 初始化数据库并加载数据
  useEffect(() => {
    const loadData = async () => {
      try {
        await initDatabase()
        
        const migrated = await migrateFromLocalStorage()
        if (migrated > 0) {
          message.success(`已迁移 ${migrated} 个连接到本地数据库`)
        }
        
        const conns = await getConnections()
        setConnections(conns)
        
        await refreshRecentConnections()
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
    return () => {
      if (dragTimerRef.current) {
        clearTimeout(dragTimerRef.current)
      }
    }
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
    setAuthType('password')
    setTestResult(null)
    setTestMessage('')
    setIsModalOpen(true)
  }

  const handleEdit = (e: React.MouseEvent, conn: Connection) => {
    e.stopPropagation()
    setEditingConnection(conn)
    form.setFieldsValue(conn)
    setAuthType(conn.keyFile ? 'key' : 'password')
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
    setAuthType(conn.keyFile ? 'key' : 'password')
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
          clearConnectionHistory(id)
          setConnections(prev => prev.filter(c => c.id !== id))
          message.success('连接已删除')
          window.dispatchEvent(new CustomEvent('connections-updated'))
        } catch (error) {
          message.error(`删除失败: ${error}`)
        }
      }
    })
  }

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return
    
    modal.confirm({
      title: '批量删除',
      content: `确定要删除选中的 ${selectedIds.length} 个连接吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          for (const id of selectedIds) {
            await deleteConnectionFromDb(id)
            clearConnectionHistory(id)
          }
          setConnections(prev => prev.filter(c => !selectedIds.includes(c.id)))
          setSelectedIds([])
          message.success(`已删除 ${selectedIds.length} 个连接`)
          window.dispatchEvent(new CustomEvent('connections-updated'))
        } catch (error) {
          message.error(`删除失败: ${error}`)
        }
      }
    })
  }

  const handleBatchChangeGroup = async () => {
    if (selectedIds.length === 0 || !batchGroup) return
    
    try {
      for (const id of selectedIds) {
        const conn = connections.find(c => c.id === id)
        if (conn) {
          const updated = { ...conn, group: batchGroup }
          await saveConnection(updated)
        }
      }
      setConnections(prev => prev.map(c => 
        selectedIds.includes(c.id) ? { ...c, group: batchGroup } : c
      ))
      setSelectedIds([])
      setIsBatchGroupModalOpen(false)
      setBatchGroup('')
      message.success(`已将 ${selectedIds.length} 个连接移至「${batchGroup}」`)
      window.dispatchEvent(new CustomEvent('connections-updated'))
    } catch (error) {
      message.error(`操作失败: ${error}`)
    }
  }

  const handleSelectAll = () => {
    if (selectedIds.length === filteredConnections.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredConnections.map(c => c.id))
    }
  }

  const handleDragStart = (connId: string) => {
    setDraggedId(connId)
  }

  const handleDragEnd = async () => {
    if (draggedId && dragOverId && dropPosition) {
      const draggedIndex = connections.findIndex(c => c.id === draggedId)
      const overIndex = connections.findIndex(c => c.id === dragOverId)
      
      if (draggedIndex !== -1 && overIndex !== -1) {
        const newConnections = [...connections]
        const [draggedItem] = newConnections.splice(draggedIndex, 1)
        
        const adjustedIndex = draggedIndex < overIndex ? overIndex - 1 : overIndex
        const insertIndex = dropPosition === 'after' ? adjustedIndex + 1 : adjustedIndex
        
        newConnections.splice(insertIndex, 0, draggedItem)
        setConnections(newConnections)
        
        const order = newConnections.map((conn, index) => ({
          id: conn.id,
          sortOrder: index
        }))
        await updateConnectionOrder(order)
      }
    }
    setDraggedId(null)
    setDragOverId(null)
    setDragPosition(null)
    setDropPosition(null)
  }

  const handlePointerDown = (connId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (isBatchMode) return
    
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current)
    }
    
    setIsDraggingActive(true)
    
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    
    dragTimerRef.current = setTimeout(() => {
      setIsReorderMode(true)
      handleDragStart(connId)
      setDragPosition({ x: e.clientX, y: e.clientY })
    }, 500)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current)
      dragTimerRef.current = null
    }
    setIsDraggingActive(false)
    if (isReorderMode) {
      handleDragEnd()
      setIsReorderMode(false)
    }
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingActive) return
    
    e.preventDefault()
    
    if (!isReorderMode || !draggedId) return
    
    setDragPosition({ x: e.clientX, y: e.clientY })
    
    const element = document.elementFromPoint(e.clientX, e.clientY)
    const card = element?.closest('[data-connection-id]')
    if (card) {
      const connId = card.getAttribute('data-connection-id')
      if (connId && connId !== draggedId) {
        const rect = (card as HTMLElement).getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        setDropPosition(e.clientY < midY ? 'before' : 'after')
        setDragOverId(connId)
      } else {
        setDragOverId(null)
        setDropPosition(null)
      }
    } else {
      setDragOverId(null)
      setDropPosition(null)
    }
  }

  const handleSubmit = async (values: Partial<Connection>) => {
    const port = typeof values.port === 'string' ? parseInt(values.port, 10) || 22 : values.port || 22
    
    try {
      if (editingConnection) {
        const updated = { ...editingConnection, ...values, port }
        await saveConnection(updated)
        setConnections(prev => prev.map(c => c.id === editingConnection.id ? updated : c))
        message.success('连接已更新')
      } else {
        const newConn: Connection = {
          id: generateUniqueId(),
          name: values.name || '',
          host: values.host || '',
          port,
          username: values.username || '',
          password: values.password,
          keyFile: values.keyFile,
          group: values.group || '默认',
          tags: values.tags || [],
          status: 'offline'
        }
        await saveConnection(newConn)
        setConnections(prev => [...prev, newConn])
        message.success('连接已添加')
      }
      setIsModalOpen(false)
      window.dispatchEvent(new CustomEvent('connections-updated'))
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
      
      await recordConnectionHistory(conn.id)
      await refreshRecentConnections()

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
      window.dispatchEvent(new CustomEvent('connections-updated'))

      if (shouldConnect) {
        setTimeout(() => handleConnect(newConn), 50)
      }
    } catch (error) {
      message.error(`保存失败: ${error}`)
    }
  }

  const handleExportConnections = () => {
    if (connections.length === 0) {
      message.warning('没有可导出的连接')
      return
    }
    setSelectedExportIds(connections.map(c => c.id))
    setExportAll(true)
    setIsExportModalOpen(true)
  }

  const handleExportConfirm = async () => {
    const toExport = exportAll ? connections : connections.filter(c => selectedExportIds.includes(c.id))
    
    if (toExport.length === 0) {
      message.warning('请选择要导出的连接')
      return
    }

    try {
      const filePath = await save({
        title: '导出连接',
        defaultPath: `iterminal_connections_${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      
      if (!filePath) return
      
      const data = JSON.stringify(toExport, null, 2)
      await writeTextFile(filePath, data)
      setIsExportModalOpen(false)
      message.success(`已导出 ${toExport.length} 个连接`)
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
      window.dispatchEvent(new CustomEvent('connections-updated'))
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
          style={{ width: 240 }}
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
        <Button 
          type={isBatchMode ? 'primary' : 'default'}
          icon={<CheckSquareOutlined />} 
          onClick={() => {
            setIsBatchMode(!isBatchMode)
            if (isBatchMode) {
              setSelectedIds([])
            }
          }}
          style={{ marginLeft: 'auto' }}
        >
          {isBatchMode ? '退出批管理' : '批管理'}
        </Button>
      </div>

      {recentConnections.length > 0 && (
        <div style={{ 
          marginBottom: 12, 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8,
          flexWrap: 'wrap'
        }}>
          <span style={{ 
            fontSize: 12, 
            color: 'var(--color-text-secondary)',
            fontWeight: 500
          }}>
            最近:
          </span>
          {recentConnections.slice(0, 6).map(conn => (
            <Button
              key={conn.id}
              size="small"
              onClick={() => handleConnect(conn)}
              style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                fontSize: 12
              }}
            >
              {conn.name}
            </Button>
          ))}
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
          <>
            {isBatchMode && (
              <div style={{ 
                marginBottom: 10, 
                padding: '8px 12px', 
                background: 'var(--color-bg-elevated)', 
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                border: '1px solid var(--color-primary)'
              }}>
                <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>
                  已选择 {selectedIds.length} 项
                </span>
                <Button 
                  size="small" 
                  onClick={handleSelectAll}
                  disabled={selectedIds.length === filteredConnections.length}
                >
                  全选
                </Button>
                <Button 
                  size="small" 
                  onClick={() => setSelectedIds([])}
                  disabled={selectedIds.length === 0}
                >
                  取消选择
                </Button>
                <Button 
                  size="small" 
                  icon={<SwapOutlined />}
                  onClick={() => setIsBatchGroupModalOpen(true)}
                  disabled={selectedIds.length === 0}
                >
                  调整分组
                </Button>
                <Button 
                  size="small" 
                  danger 
                  icon={<DeleteOutlined />}
                  onClick={handleBatchDelete}
                  disabled={selectedIds.length === 0}
                >
                  批量删除
                </Button>
              </div>
            )}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
              gap: 10,
              userSelect: isDraggingActive ? 'none' : 'auto',
              WebkitUserSelect: isDraggingActive ? 'none' : 'auto',
            }}>
              {filteredConnections.map(conn => (
                <div key={conn.id} style={{ position: 'relative' }}>
                  {dragOverId === conn.id && dropPosition === 'before' && (
                    <div style={{
                      position: 'absolute',
                      top: -2,
                      left: 0,
                      right: 0,
                      height: 4,
                      background: 'var(--color-primary)',
                      borderRadius: 2,
                      zIndex: 10
                    }} />
                  )}
                  <Card
                    data-connection-id={conn.id}
                    size="small"
                    hoverable={conn.status !== 'connecting'}
                    style={{
                      background: 'var(--color-bg-elevated)',
                      borderColor: draggedId === conn.id ? 'var(--color-primary)' : (dragOverId === conn.id ? 'var(--color-primary)' : ((isBatchMode && selectedIds.includes(conn.id)) ? 'var(--color-primary)' : (conn.status === 'connecting' ? 'var(--color-info)' : 'var(--color-border)'))),
                      cursor: isReorderMode ? 'grabbing' : 'pointer',
                      opacity: draggedId === conn.id ? 0.3 : (conn.status === 'connecting' ? 0.85 : 1),
                      transition: 'all 0.15s ease',
                    }}
                    styles={{ body: { padding: '10px 12px' } }}
                    onPointerDown={(e) => handlePointerDown(conn.id, e)}
                    onPointerUp={handlePointerUp}
                    onPointerMove={handlePointerMove}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={() => {
                      if (!isReorderMode && dragTimerRef.current) {
                        clearTimeout(dragTimerRef.current)
                        dragTimerRef.current = null
                        setIsDraggingActive(false)
                      }
                    }}
                    onClick={() => {
                      if (isReorderMode) return
                      if (isBatchMode) {
                        setSelectedIds(prev => 
                          prev.includes(conn.id) ? prev.filter(id => id !== conn.id) : [...prev, conn.id]
                        )
                      } else if (conn.status !== 'connecting') {
                        handleConnect(conn)
                      }
                    }}
                  >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
                      {isBatchMode && (
                        <Checkbox
                          checked={selectedIds.includes(conn.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(prev => [...prev, conn.id])
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== conn.id))
                            }
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ 
                            color: conn.group === '生产环境' ? '#E65100' : 'var(--color-text)', 
                            fontWeight: 500,
                            fontSize: 13,
                          }}>{conn.name}</span>
                          <span style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: conn.status === 'connecting' ? 'var(--color-info)' : (isConnected(conn.id) ? 'var(--color-success)' : getStatusColor(conn.status)),
                          }} />
                        </div>
                        <div style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginTop: 2 }}>
                          {conn.username}@{conn.host}:{conn.port}
                        </div>
                        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <Tag style={{ background: 'var(--color-border)', border: 'none', color: 'var(--color-text)', fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>
                            {conn.group}
                          </Tag>
                          {conn.tags.slice(0, 2).map(tag => (
                            <Tag key={tag} style={{ background: 'var(--color-primary)', border: 'none', color: '#fff', fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>
                              {tag}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 8 }}>
                      <Button
                        type="text"
                        size="small"
                        icon={<EnvironmentOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => handleQuickCopy(e, conn.host, 'IP')}
                        style={{ color: 'var(--color-text-tertiary)', fontSize: 10, padding: '0 4px', height: 18 }}
                      >
                        IP
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        icon={<KeyOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => handleQuickCopy(e, `名称: ${conn.name}\n地址: ${conn.host}\n端口: ${conn.port}\n用户: ${conn.username}\n密码: ${conn.password || '无'}`, '信息')}
                        style={{ color: 'var(--color-text-tertiary)', fontSize: 10, padding: '0 4px', height: 18 }}
                      >
                        信息
                      </Button>
                    </div>
                  </div>
                  {!isBatchMode && (
                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 4, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => handleDelete(e, conn.id, conn.name)}
                        style={{ padding: '0 4px', height: 20, fontSize: 11 }}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => handleEdit(e, conn)}
                        style={{ padding: '0 4px', height: 20, fontSize: 11 }}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => handleCopyConfig(e, conn)}
                        style={{ padding: '0 4px', height: 20, fontSize: 11 }}
                      >
                        复制
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        icon={conn.status === 'connecting' ? <LoadingOutlined style={{ fontSize: 11 }} /> : <PlayCircleOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => { 
                          e.stopPropagation()
                          if (conn.status !== 'connecting') handleConnect(conn) 
                        }}
                        style={{ color: conn.status === 'connecting' ? 'var(--color-info)' : undefined, padding: '0 4px', height: 20, fontSize: 11 }}
                      >
                        {conn.status === 'connecting' ? '连接中' : (isConnected(conn.id) ? '打开' : '连接')}
                      </Button>
                    </div>
                  )}
                {conn.status === 'connecting' && (
                    <div className="connecting-progress-bar" />
                  )}
                </Card>
                {dragOverId === conn.id && dropPosition === 'after' && (
                  <div style={{
                    position: 'absolute',
                    bottom: -2,
                    left: 0,
                    right: 0,
                    height: 4,
                    background: 'var(--color-primary)',
                    borderRadius: 2,
                    zIndex: 10
                  }} />
                )}
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      <Modal
        title={editingConnection ? '编辑连接' : '新建连接'}
        open={isModalOpen}
        onOk={form.submit}
        onCancel={() => setIsModalOpen(false)}
        width={480}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} size="small" style={{ marginTop: -8 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入连接名称' }]} style={{ marginBottom: 12 }}>
            <Input placeholder="连接名称" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={18}>
              <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机地址' }]} style={{ marginBottom: 12 }}>
                <Input placeholder="IP 地址或主机名" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="port" label="端口" initialValue={22} style={{ marginBottom: 12 }}>
                <Input 
                  placeholder="22" 
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault()
                    }
                  }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]} style={{ marginBottom: 12 }}>
            <Input placeholder="root" />
          </Form.Item>
          <Form.Item label="认证方式" style={{ marginBottom: 8 }}>
            <Radio.Group 
              value={authType} 
              onChange={(e) => {
                const type = e.target.value
                setAuthType(type)
                if (type === 'password') {
                  form.setFieldValue('keyFile', undefined)
                } else {
                  form.setFieldValue('password', undefined)
                }
              }}
            >
              <Radio value="password">密码</Radio>
              <Radio value="key">密钥</Radio>
            </Radio.Group>
          </Form.Item>
          {authType === 'password' ? (
            <Form.Item name="password" label="密码" style={{ marginBottom: 12 }}>
              <Input.Password placeholder="输入密码" />
            </Form.Item>
          ) : (
            <Form.Item 
              name="keyFile" 
              label="密钥文件"
              rules={[{ required: true, message: '请选择或输入密钥文件路径' }]}
              style={{ marginBottom: 12 }}
            >
              <Input 
                placeholder="~/.ssh/id_rsa"
                addonAfter={
                  <FolderOpenOutlined 
                    style={{ cursor: 'pointer', fontSize: 12 }}
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
          )}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="group" label="分组" initialValue="默认" style={{ marginBottom: 12 }}>
                <Select options={groupOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tags" label="标签" style={{ marginBottom: 12 }}>
                <Select mode="tags" placeholder="添加标签" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button 
                onClick={handleTestConnection}
                loading={testLoading}
                size="small"
              >
                测试连接
              </Button>
              {testResult && (
                <Space size={4}>
                  {testResult === 'success' ? (
                    <CheckCircleOutlined style={{ color: 'var(--color-success)', fontSize: 14 }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: 'var(--color-error)', fontSize: 14 }} />
                  )}
                  <span style={{ 
                    color: testResult === 'success' ? 'var(--color-success)' : 'var(--color-error)',
                    fontSize: 12
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

      <Modal
        title="导出连接"
        open={isExportModalOpen}
        onCancel={() => setIsExportModalOpen(false)}
        onOk={handleExportConfirm}
        okText="导出"
        cancelText="取消"
        width={500}
      >
        <div style={{ marginBottom: 12 }}>
          <Checkbox
            checked={exportAll}
            onChange={(e) => {
              setExportAll(e.target.checked)
              if (e.target.checked) {
                setSelectedExportIds(connections.map(c => c.id))
              }
            }}
          >
            全部导出 ({connections.length} 个连接)
          </Checkbox>
        </div>
        
        {!exportAll && (
          <>
            <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
              <Button 
                size="small"
                onClick={() => setSelectedExportIds(connections.map(c => c.id))}
              >
                全选
              </Button>
              <Button 
                size="small"
                onClick={() => setSelectedExportIds([])}
              >
                取消全选
              </Button>
            </div>
            <div style={{ 
              maxHeight: 300, 
              overflow: 'auto', 
              border: '1px solid var(--color-border)', 
              borderRadius: 4,
              padding: 8 
            }}>
              <Checkbox.Group
                value={selectedExportIds}
                onChange={(values) => setSelectedExportIds(values.filter((v): v is string => typeof v === 'string'))}
                style={{ width: '100%' }}
              >
                <Row gutter={[8, 8]}>
                  {connections.map(conn => (
                    <Col span={24} key={conn.id}>
                      <Checkbox value={conn.id} style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {conn.name}
                        </span>
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginLeft: 8, whiteSpace: 'nowrap' }}>
                          ({conn.host})
                        </span>
                      </Checkbox>
                    </Col>
                  ))}
                </Row>
              </Checkbox.Group>
            </div>
          </>
        )}
        
        <div style={{ marginTop: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>
          已选择 {exportAll ? connections.length : selectedExportIds.length} 个连接
        </div>
      </Modal>

      <Modal
        title="批量调整分组"
        open={isBatchGroupModalOpen}
        onCancel={() => {
          setIsBatchGroupModalOpen(false)
          setBatchGroup('')
        }}
        onOk={handleBatchChangeGroup}
        okText="确定"
        cancelText="取消"
        width={400}
      >
        <div style={{ marginBottom: 12 }}>
          将选中的 <strong>{selectedIds.length}</strong> 个连接移至：
        </div>
        <Select
          value={batchGroup}
          onChange={setBatchGroup}
          options={groupOptions}
          style={{ width: '100%' }}
          placeholder="选择目标分组"
        />
      </Modal>

      {isReorderMode && draggedConnection && dragPosition && (
        <div style={{
          position: 'fixed',
          left: dragPosition.x - 140,
          top: dragPosition.y - 30,
          width: 280,
          padding: '10px 12px',
          background: 'var(--color-bg-elevated)',
          border: '2px solid var(--color-primary)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
          zIndex: 1000,
          pointerEvents: 'none',
          opacity: 0.95
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ 
              color: draggedConnection.group === '生产环境' ? '#E65100' : 'var(--color-text)', 
              fontWeight: 500,
              fontSize: 13,
            }}>{draggedConnection.name}</span>
          </div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginTop: 2 }}>
            {draggedConnection.username}@{draggedConnection.host}:{draggedConnection.port}
          </div>
        </div>
      )}
    </div>
  )
}

export default Connections