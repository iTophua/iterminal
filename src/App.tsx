import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout } from 'antd'
import Sidebar from './components/Sidebar'
import Connections from './pages/Connections'
import Terminal from './pages/Terminal'
import Transfers from './pages/Transfers'
import { useTerminalStore } from './stores/terminalStore'
import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'
import './styles/global.css'

const { Content } = Layout

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