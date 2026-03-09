import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from 'antd'
import Sidebar from './components/Sidebar'
import Connections from './pages/Connections'
import Terminal from './pages/Terminal'
import FileManager from './pages/FileManager'
import './styles/global.css'

const { Content } = Layout

function App() {
  return (
    <BrowserRouter>
      <Layout style={{ minHeight: '100vh', background: '#1E1E1E' }}>
        {/* 顶部导航栏 */}
        <div style={{
          height: 48,
          background: '#252526',
          borderBottom: '1px solid #3F3F46',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px'
        }}>
          <span style={{ color: '#00b96b', fontSize: 16, fontWeight: 'bold' }}>iTerminal</span>
        </div>

        <Layout style={{ flex: 1, display: 'flex' }}>
          {/* 左侧导航栏 */}
          <Sidebar />

          {/* 主内容区 */}
          <Content style={{
            margin: 0,
            padding: 0,
            background: '#1E1E1E',
            overflow: 'hidden',
            flex: 1,
            display: 'flex',
            flexDirection: 'column'
          }}>
            <Routes>
              <Route path="/" element={<Navigate to="/connections" replace />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/terminal" element={<Terminal />} />
              <Route path="/files" element={<FileManager />} />
            </Routes>
          </Content>
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
          iTerminal - SSH Connection Manager ©2026
        </div>
      </Layout>
    </BrowserRouter>
  )
}

export default App