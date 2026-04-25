import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Modal, Button, Space, message } from 'antd'
import Sidebar from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import Connections from './pages/Connections'
import Terminal from './pages/Terminal'
import TerminalWindowPage from './pages/TerminalWindow'
import Transfers from './pages/Transfers'
import { useTerminalStore, type SplitPane } from './stores/terminalStore'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { readText as readClipboardText } from '@tauri-apps/plugin-clipboard-manager'
import './styles/global.css'

const { Content } = Layout

const SESSION_STORAGE_KEY = 'iterminal_saved_sessions'

interface SavedSession {
  connectionId: string
  rootPane: SplitPane
  savedAt: number
}

function MenuActionHandler() {
  const navigate = useNavigate()
  const setSettingsVisible = useTerminalStore(s => s.setSettingsVisible)
  const [aboutVisible, setAboutVisible] = useState(false)

  useEffect(() => {
    const unlisten = listen<string>('menu-action', (event) => {
      const action = event.payload
      switch (action) {
        case 'new-connection':
          navigate('/connections')
          break
        case 'import-connections':
          window.dispatchEvent(new CustomEvent('import-connections'))
          break
        case 'export-connections':
          window.dispatchEvent(new CustomEvent('export-connections'))
          break
        case 'open-settings':
          setSettingsVisible(true)
          break
        case 'copy':
          document.execCommand('copy')
          break
        case 'paste': {
            const activeElement = document.activeElement
            const isEditable = activeElement && (
              activeElement.tagName === 'INPUT' ||
              activeElement.tagName === 'TEXTAREA' ||
              (activeElement as HTMLElement).isContentEditable
            )
            if (isEditable) {
              readClipboardText().then(text => {
                if (text) {
                  document.execCommand('insertText', false, text)
                }
              }).catch(() => {})
            } else {
              document.execCommand('paste')
            }
            break
          }
        case 'select-all':
          document.execCommand('selectAll')
          break
        case 'toggle-fullscreen':
          getCurrentWindow().toggleMaximize()
          break
        case 'show-about':
          setAboutVisible(true)
          break
      }
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [navigate, setSettingsVisible])

  if (!aboutVisible) return null

  return (
    <Modal
      open={aboutVisible}
      title="关于 iTerminal"
      onCancel={() => setAboutVisible(false)}
      footer={<Button onClick={() => setAboutVisible(false)}>关闭</Button>}
      width={400}
    >
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🖥️</div>
        <div style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>iTerminal</div>
        <div style={{ color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          SSH 连接管理器
        </div>
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
          一款现代化的 SSH 终端管理工具
        </div>
      </div>
    </Modal>
  )
}

function SessionRestorer() {
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([])
  const [restoreModalVisible, setRestoreModalVisible] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const restoreConnection = useTerminalStore(s => s.restoreConnection)
  const allConnections = useTerminalStore(s => s.allConnections)
  const connectedConnections = useTerminalStore(s => s.connectedConnections)

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY)
    if (saved) {
      try {
        const sessions: SavedSession[] = JSON.parse(saved)
        const recentSessions = sessions.filter(s => Date.now() - s.savedAt < 24 * 60 * 60 * 1000)
        if (recentSessions.length > 0) {
          setSavedSessions(recentSessions)
          setRestoreModalVisible(true)
        } else {
          // 所有会话都已过期，清除 localStorage 避免下次启动再次读取
          localStorage.removeItem(SESSION_STORAGE_KEY)
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
        // 校验该连接是否已在连接 tab 中
        if (connectedConnections.some(c => c.connectionId === session.connectionId)) {
          message.warning(`连接 "${session.connectionId}" 已在标签页中，跳过恢复`)
          continue
        }

        const conn = allConnections.find(c => c.id === session.connectionId)
        if (!conn) {
          console.error(`恢复连接失败: 未找到连接 ${session.connectionId}`)
          continue
        }

        await invoke('connect_ssh', {
          id: conn.id,
          connection: {
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: conn.password,
            key_file: conn.keyFile,
          }
        })

        // 先获取所有新的 shellId，再 restoreConnection，避免 Terminal 初始化时用到旧的 shellId
        const sessions = getAllSessionsFromPane(session.rootPane)
        const shellIdMap: Record<string, string> = {}
        for (const s of sessions) {
          const newShellId = await invoke<string>('get_shell', { id: conn.id })
          shellIdMap[s.id] = newShellId
        }

        const updatePaneShellIds = (pane: SplitPane): SplitPane => ({
          ...pane,
          sessions: pane.sessions.map(s => ({
            ...s,
            shellId: shellIdMap[s.id] || s.shellId,
          })),
          children: pane.children?.map(updatePaneShellIds),
        })
        const updatedRootPane = updatePaneShellIds(session.rootPane)

        restoreConnection(conn, updatedRootPane)

        restored++
      } catch (err) {
        console.error(`恢复连接失败:`, err)
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
        {savedSessions.map(s => {
          const conn = allConnections.find(c => c.id === s.connectionId)
          const alreadyConnected = connectedConnections.some(c => c.connectionId === s.connectionId)
          return (
            <div key={s.connectionId} style={{ padding: '8px 12px', background: 'var(--color-bg-container)', borderRadius: 4, marginBottom: 8, opacity: alreadyConnected ? 0.5 : 1 }}>
              <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                {conn?.name || s.connectionId}
                {alreadyConnected && <span style={{ fontSize: 11, color: 'var(--color-primary)', border: '1px solid var(--color-primary)', padding: '0 6px', borderRadius: 4 }}>已连接</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {conn ? `${conn.username}@${conn.host}:${conn.port}` : '连接信息缺失'}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function getAllSessionsFromPane(pane: SplitPane): Array<{ id: string; connectionId: string }> {
  const sessions: Array<{ id: string; connectionId: string }> = []
  const traverse = (p: SplitPane) => {
    for (const s of p.sessions) {
      sessions.push({ id: s.id, connectionId: s.connectionId })
    }
    if (p.children) {
      p.children.forEach(traverse)
    }
  }
  traverse(pane)
  return sessions
}

function SessionSaver() {
  const connectedConnections = useTerminalStore(s => s.connectedConnections)
  const savedRef = useRef(false)
  const isClosing = useRef(false)

  useEffect(() => {
    const appWindow = getCurrentWindow()
    let unlisten: (() => void) | null = null

    // 使用 onCloseRequested 阻止默认关闭行为，确保异步清理完成后再关闭窗口
    appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      if (isClosing.current) return
      isClosing.current = true
      
      if (connectedConnections.length > 0 && !savedRef.current) {
        // 保存前清除 shellId，避免恢复时用到已失效的后端 shell 标识
        const clearShellIds = (pane: SplitPane): SplitPane => ({
          ...pane,
          sessions: pane.sessions.map(s => ({ ...s, shellId: '' })),
          children: pane.children?.map(clearShellIds),
        })
        const sessions: SavedSession[] = connectedConnections.map(conn => ({
          connectionId: conn.connectionId,
          rootPane: clearShellIds(conn.rootPane),
          savedAt: Date.now(),
        }))
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions))
        savedRef.current = true
      }
      
      for (const conn of connectedConnections) {
        await invoke('disconnect_ssh', { id: conn.connectionId }).catch(() => {})
      }
      
      await appWindow.close().catch(() => {})
    }).then(fn => {
      unlisten = fn
    })

    return () => {
      if (unlisten) unlisten()
    }
  }, [connectedConnections])

  return null
}

// 页面切换动画包装组件
function AnimatedPage({ show, children, padding = false }: { show: boolean; children: React.ReactNode; padding?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: padding ? 16 : 0,
        overflow: padding ? 'auto' : 'hidden',
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.995)',
        transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: show ? 'auto' : 'none',
        zIndex: show ? 1 : 0,
      }}
    >
      {children}
    </div>
  )
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
      <AnimatedPage show={location.pathname === '/terminal'}>
        <Terminal />
      </AnimatedPage>
      
      {/* 连接管理组件始终挂载，用 CSS 控制显示/隐藏 */}
      <AnimatedPage show={location.pathname === '/connections'} padding>
        <Connections />
      </AnimatedPage>
      
      <AnimatedPage show={location.pathname === '/transfers'} padding>
        <Transfers />
      </AnimatedPage>
      
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
    <HashRouter>
      <Routes>
        <Route path="/terminal-window" element={<TerminalWindowPage />} />
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </HashRouter>
  )
}

function MainApp() {
  return (
    <>
      <SessionRestorer />
      <SessionSaver />
      <MenuActionHandler />
      <TitleBar />
      <Layout style={{
        minHeight: 'calc(100vh - 28px)',
        background: 'var(--color-bg-container)',
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}>

        <Layout style={{ flex: 1, display: 'flex' }}>
          <Sidebar />

          <MainContent />
        </Layout>

        <div className="footer-bar" style={{
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-tertiary)',
          fontSize: 12,
          gap: 8,
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            display: 'inline-block',
            opacity: 0.7,
          }} />
          <span className="gradient-text" style={{ fontWeight: 500, letterSpacing: 0.3 }}>iTerminal - SSH 连接管理器 ©2026</span>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            display: 'inline-block',
            opacity: 0.7,
          }} />
        </div>
      </Layout>
    </>
  )
}

export default App