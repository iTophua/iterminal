import { Layout, Menu, Badge } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { CloudServerOutlined, FolderOutlined, DesktopOutlined, CodeOutlined } from '@ant-design/icons'
import { useState, useEffect } from 'react'
import { useTerminalStore } from '../stores/terminalStore'

const { Sider } = Layout

const STORAGE_KEY = 'iterminal_connections'

interface Connection {
  id: string
  group: string
}

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [groups, setGroups] = useState<string[]>(['全部', '生产环境', '开发环境', '测试环境'])
  
  // 获取已连接的连接数量
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const connectedCount = connectedConnections.length

  // 从localStorage加载分组
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const connections: Connection[] = JSON.parse(saved)
      const uniqueGroups = [...new Set(connections.map(c => c.group))]
      setGroups(['全部', ...uniqueGroups])
    }
  }, [location.pathname])

  // 根据当前路径确定选中的key
  const getSelectedKey = () => {
    return location.pathname
  }

  const menuItems = [
    { key: 'divider', type: 'divider' as const },
    ...groups.map(group => ({
      key: group === '全部' ? '/connections' : `/connections?group=${encodeURIComponent(group)}`,
      icon: group === '全部' ? <DesktopOutlined /> : <CloudServerOutlined />,
      label: group,
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
    { key: '/files', icon: <FolderOutlined />, label: '文件管理' },
  ]

  const handleMenuClick = (key: string) => {
    if (key.startsWith('/connections')) {
      // 如果是分组菜单，传递分组参数
      const url = new URLSearchParams(key.split('?')[1] || '')
      const group = url.get('group')
      if (group) {
        navigate('/connections', { state: { selectedGroup: group } })
      } else {
        navigate('/connections', { state: { selectedGroup: '全部' } })
      }
    } else if (key === '/connections') {
      navigate('/connections', { state: { selectedGroup: '全部' } })
    } else {
      navigate(key)
    }
  }

  return (
    <Sider
      width={240}
      style={{
        background: '#252526',
        borderRight: '1px solid #3F3F46'
      }}
    >
      <Menu
        mode="inline"
        selectedKeys={[getSelectedKey()]}
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