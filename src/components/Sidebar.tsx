import { Layout, Menu, Badge } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { CloudServerOutlined, DesktopOutlined, CodeOutlined, SwapOutlined } from '@ant-design/icons'
import { useState, useEffect, useMemo } from 'react'
import { useTerminalStore } from '../stores/terminalStore'
import { useTransferStore } from '../stores/transferStore'

const { Sider } = Layout

const STORAGE_KEY = 'iterminal_connections'
const COLLAPSED_KEY = 'iterminal_sidebar_collapsed'

interface Connection {
  id: string
  group: string
}

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [groups, setGroups] = useState<string[]>(['全部', '生产环境', '开发环境', '测试环境'])
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({})
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem(COLLAPSED_KEY)
    return saved ? JSON.parse(saved) : false
  })
  
  const connectedCount = useTerminalStore(state => state.connectedConnections.length)
  const transferringCount = useTransferStore(state => state.transferringCount)
  const storeSidebarCollapsed = useTerminalStore(state => state.sidebarCollapsed)
  const setSidebarCollapsed = useTerminalStore(state => state.setSidebarCollapsed)
  
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const connections: Connection[] = JSON.parse(saved)
      const uniqueGroups = [...new Set(connections.map(c => c.group))]
      setGroups(['全部', ...uniqueGroups])
      
      const counts: Record<string, number> = { '全部': connections.length }
      connections.forEach(c => {
        counts[c.group] = (counts[c.group] || 0) + 1
      })
      setGroupCounts(counts)
    }
  }, [location.pathname])
  
  useEffect(() => {
    const handleConnectionsUpdate = () => {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const connections: Connection[] = JSON.parse(saved)
        const uniqueGroups = [...new Set(connections.map(c => c.group))]
        setGroups(['全部', ...uniqueGroups])
        
        const counts: Record<string, number> = { '全部': connections.length }
        connections.forEach(c => {
          counts[c.group] = (counts[c.group] || 0) + 1
        })
        setGroupCounts(counts)
      }
    }
    
    window.addEventListener('connections-updated', handleConnectionsUpdate)
    return () => window.removeEventListener('connections-updated', handleConnectionsUpdate)
  }, [])
  
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed))
  }, [collapsed])
  
  useEffect(() => {
    if (storeSidebarCollapsed !== collapsed) {
      setCollapsed(storeSidebarCollapsed)
    }
  }, [storeSidebarCollapsed, collapsed])
  
  const selectedKey = useMemo(() => {
    if (location.pathname !== '/connections') {
      return location.pathname
    }
    const params = new URLSearchParams(location.search)
    const group = params.get('group') || '全部'
    return group === '全部' ? '/connections' : `/connections?group=${encodeURIComponent(group)}`
  }, [location.pathname, location.search])

  const menuItems = useMemo(() => [
    { key: 'divider', type: 'divider' as const },
    ...groups.map(group => ({
      key: group === '全部' ? '/connections' : `/connections?group=${encodeURIComponent(group)}`,
      icon: group === '全部' ? <DesktopOutlined /> : <CloudServerOutlined />,
      label: (
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span>{group}</span>
          {groupCounts[group] !== undefined && (
            <span style={{ color: '#666', fontSize: 12 }}>{groupCounts[group]}</span>
          )}
        </span>
      ),
    })),
    { key: 'divider2', type: 'divider' as const },
    { 
      key: '/terminal', 
      icon: <CodeOutlined />,
      label: (
        <span>
          终端
          {connectedCount > 0 && (
            <Badge count={connectedCount} size="small" style={{ marginLeft: 8, backgroundColor: '#52c41a' }} />
          )}
        </span>
      )
    },
    {
      key: '/transfers',
      icon: <SwapOutlined />,
      label: (
        <span>
          传输管理
          {transferringCount > 0 && (
            <Badge count={transferringCount} size="small" style={{ marginLeft: 8, backgroundColor: '#1890ff' }} />
          )}
        </span>
      ),
    },
  ], [groups, groupCounts, connectedCount, transferringCount])

  const handleMenuClick = (key: string) => {
    if (key.startsWith('/connections')) {
      const url = new URLSearchParams(key.split('?')[1] || '')
      const group = url.get('group')
      if (group) {
        navigate(`/connections?group=${encodeURIComponent(group)}`)
      } else {
        navigate('/connections')
      }
    } else {
      navigate(key)
    }
  }

  return (
    <Sider
      width={240}
      collapsedWidth={48}
      collapsible
      collapsed={collapsed}
      onCollapse={(collapsed) => setCollapsed(collapsed)}
      style={{
        background: '#252526',
        borderRight: '1px solid #3F3F46'
      }}
      trigger={null}
    >
      {/* 标题和折叠按钮 */}
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? 0 : '0 16px',
          borderBottom: '1px solid #3F3F46',
          cursor: 'pointer'
        }}
        onClick={() => {
          const newState = !collapsed
          setCollapsed(newState)
          setSidebarCollapsed(newState)
        }}
      >
        <span style={{ color: '#00b96b', fontSize: 16, fontWeight: 'bold' }}>
          {collapsed ? 'i' : 'iTerminal'}
        </span>
        {!collapsed && (
          <span style={{ color: '#CCCCCC', fontSize: 16 }}>←</span>
        )}
      </div>
      
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        style={{
          background: '#252526',
          borderRight: 'none',
          color: '#CCCCCC'
        }}
        items={menuItems}
        onClick={(e) => handleMenuClick(e.key)}
      />
    </Sider>
  )
}

export default Sidebar

