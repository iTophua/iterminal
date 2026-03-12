import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout } from 'antd'
import Sidebar from './components/Sidebar'
import Connections from './pages/Connections'
import Terminal from './pages/Terminal'
import Transfers from './pages/Transfers'
import './styles/global.css'

const { Content } = Layout

// 主内容组件 - 处理终端的持久化
function MainContent() {
  const location = useLocation()
  
  return (
    <Content style={{
      margin: 0,
      padding: 0,
      background: '#1E1E1E',
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
      <Layout style={{ minHeight: '100vh', background: '#1E1E1E' }}>

        <Layout style={{ flex: 1, display: 'flex' }}>
          {/* 左侧导航栏 */}
          <Sidebar />

          {/* 主内容区 */}
          <MainContent />
        </Layout>

        {/* 底部状态栏 */}
        <div style={{
          height: 32,
          background: '#252526',
          borderTop: '1px solid #3F3F46',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999999',
          fontSize: 12
        }}>
          iTerminal - SSH 连接管理器 ©2026
        </div>
      </Layout>
    </BrowserRouter>
  )
}

export default App