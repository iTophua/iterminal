import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout, Modal, Button, Space, message } from 'antd'
import Sidebar from './components/Sidebar'
import Connections from './pages/Connections'
import Terminal from './pages/Terminal'
import Transfers from './pages/Transfers'
import { useTerminalStore, type SplitPane } from './stores/terminalStore'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import './styles/global.css'

const { Content } = Layout

const SESSION_STORAGE_KEY = 'iterminal_saved_sessions'

function countSessionsInPane(pane: SplitPane): number {
  if (pane.children) {
    return pane.children.reduce((sum, child) => sum + countSessionsInPane(child), 0)
  }
  return pane.sessions.length
}

interface SavedSession {
  connectionId: string
  connection: {
    id: string
    name: string
    host: string
    port: number
    username: string
    password?: string
    keyFile?: string
    group: string
    tags: string[]
  }
  sessionCount: number
  savedAt: number
}

function FontPreloader() {
  const setAvailableFonts = useTerminalStore(s => s.setAvailableFonts)
  const setFontsLoading = useTerminalStore(s => s.setFontsLoading)
  const availableFonts = useTerminalStore(s => s.availableFonts)

  useEffect(() => {
    if (availableFonts.length === 0) {
      setFontsLoading(true)
      invoke<string[]>('get_monospace_fonts')
        .then(fonts => setAvailableFonts(fonts))
        .catch(err => {
          console.error('Failed to load fonts:', err)
          setAvailableFonts(['Menlo', 'Monaco', 'Courier New'])
        })
        .finally(() => setFontsLoading(false))
    }
  }, [availableFonts.length, setAvailableFonts, setFontsLoading])

  return null
}

function WindowStateRestorer() {
  useEffect(() => {
    invoke('restore_window_state').catch(err => {
      console.error('Failed to restore window state:', err)
    })
  }, [])

  return null
}

function SessionRestorer() {
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([])
  const [restoreModalVisible, setRestoreModalVisible] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const addConnection = useTerminalStore(s => s.addConnection)
  const setActiveConnection = useTerminalStore(s => s.setActiveConnection)

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY)
    if (saved) {
      try {
        const sessions: SavedSession[] = JSON.parse(saved)
        const recentSessions = sessions.filter(s => Date.now() - s.savedAt < 24 * 60 * 60 * 1000)
        if (recentSessions.length > 0) {
          setSavedSessions(recentSessions)
          setRestoreModalVisible(true)
        }
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY)
      }
    }
  }, [])

  const handleRestore = async () => {
    setRestoring(true)
    let restored = 0
    for (const session of savedSessions) {
      try {
        await invoke('connect_ssh', {
          id: session.connectionId,
          connection: {
            host: session.connection.host,
            port: session.connection.port,
            username: session.connection.username,
            password: session.connection.password,
            key_file: session.connection.keyFile,
          }
        })
        const shellId = await invoke<string>('get_shell', { id: session.connectionId })
        addConnection({
          ...session.connection,
          status: 'online',
        }, shellId)
        restored++
      } catch (err) {
        console.error(`恢复连接 ${session.connection.name} 失败:`, err)
      }
    }
    setRestoring(false)
    setRestoreModalVisible(false)
    localStorage.removeItem(SESSION_STORAGE_KEY)
    if (restored > 0) {
      message.success(`已恢复 ${restored} 个连接`)
    }
  }

  const handleSkip = () => {
    setRestoreModalVisible(false)
    localStorage.removeItem(SESSION_STORAGE_KEY)
  }

  if (!restoreModalVisible) return null

  return (
    <Modal
      open={restoreModalVisible}
      title="恢复上次会话"
      onCancel={handleSkip}
      footer={
        <Space>
          <Button onClick={handleSkip}>跳过</Button>
          <Button type="primary" loading={restoring} onClick={handleRestore}>
            恢复连接
          </Button>
        </Space>
      }
      width={500}
    >
      <p style={{ marginBottom: 16 }}>检测到上次未关闭的连接，是否重新连接？</p>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {savedSessions.map(s => (
          <div key={s.connectionId} style={{ padding: '8px 12px', background: 'var(--color-bg-container)', borderRadius: 4, marginBottom: 8 }}>
            <div style={{ fontWeight: 500 }}>{s.connection.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {s.connection.username}@{s.connection.host}:{s.connection.port}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function SessionSaver() {
  const connectedConnections = useTerminalStore(s => s.connectedConnections)
  const savedRef = useRef(false)

  useEffect(() => {
    const unlisten = listen('tauri://close-requested', async () => {
      if (connectedConnections.length > 0 && !savedRef.current) {
        const sessions: SavedSession[] = connectedConnections.map(conn => ({
          connectionId: conn.connectionId,
          connection: conn.connection,
          sessionCount: countSessionsInPane(conn.rootPane),
          savedAt: Date.now(),
        }))
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions))
        savedRef.current = true
      }
      
      await invoke('save_window_state').catch(() => {})
      
      for (const conn of connectedConnections) {
        await invoke('disconnect_ssh', { id: conn.connectionId }).catch(() => {})
      }
      
      window.close()
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [connectedConnections])

  return null
}

// 主内容组件 - 处理终端的持久化
function MainContent() {
  const location = useLocation()
  
  return (
    <Content style={{
      margin: 0,
      padding: 0,
      background: 'var(--color-bg-container)',
      overflow: 'hidden',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      {/* 终端组件始终挂载，用 CSS 控制显示/隐藏 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: location.pathname === '/terminal' ? 'flex' : 'none',
        flexDirection: 'column'
      }}>
        <Terminal />
      </div>
      
      {/* 连接管理组件始终挂载，用 CSS 控制显示/隐藏 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: location.pathname === '/connections' ? 'flex' : 'none',
        flexDirection: 'column',
        padding: 16,
        overflow: 'auto'
      }}>
        <Connections />
      </div>
      
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: location.pathname === '/transfers' ? 'flex' : 'none',
        flexDirection: 'column',
        padding: 16,
        overflow: 'auto'
      }}>
        <Transfers />
      </div>
      
      {/* 路由仅用于 URL 导航 */}
      <Routes>
        <Route path="/" element={<Navigate to="/connections" replace />} />
        <Route path="/connections" element={null} />
        <Route path="/transfers" element={null} />
        <Route path="/terminal" element={null} />
      </Routes>
    
    </Content>
  )
}

function App() {
  return (
    <BrowserRouter>
      <FontPreloader />
      <WindowStateRestorer />
      <SessionRestorer />
      <SessionSaver />
      <Layout style={{ minHeight: '100vh', background: 'var(--color-bg-container)' }}>

        <Layout style={{ flex: 1, display: 'flex' }}>
          {/* 左侧导航栏 */}
          <Sidebar />

          {/* 主内容区 */}
          <MainContent />
        </Layout>

        {/* 底部状态栏 */}
        <div style={{
          height: 32,
          background: 'var(--color-bg-elevated)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-tertiary)',
          fontSize: 12
        }}>
          iTerminal - SSH 连接管理器 ©2026
        </div>
      </Layout>
    </BrowserRouter>
  )
}

export default App