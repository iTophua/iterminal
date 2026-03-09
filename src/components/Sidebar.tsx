import { Layout, Menu } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { CloudServerOutlined, FolderOutlined, DesktopOutlined } from '@ant-design/icons'
import { useState, useEffect } from 'react'

const { Sider } = Layout

const STORAGE_KEY = 'iterminal_connections'

interface Connection {
  id: string
  group: string
}

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [groups, setGroups] = useState<string[]>(['All', 'Production', 'Development', 'Testing'])

  // 从localStorage加载分组
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const connections: Connection[] = JSON.parse(saved)
      const uniqueGroups = [...new Set(connections.map(c => c.group))]
      setGroups(['All', ...uniqueGroups])
    }
  }, [location.pathname])

  // 根据当前路径确定选中的key
  const getSelectedKey = () => {
    return location.pathname
  }

  const menuItems = [
    { key: 'divider', type: 'divider' as const },
    ...groups.map(group => ({
      key: group === 'All' ? '/connections' : `/connections?group=${encodeURIComponent(group)}`,
      icon: group === 'All' ? <DesktopOutlined /> : <CloudServerOutlined />,
      label: group,
    })),
    { key: 'divider2', type: 'divider' as const },
    { key: '/files', icon: <FolderOutlined />, label: 'File Manager' },
  ]

  const handleMenuClick = (key: string) => {
    if (key.startsWith('/connections')) {
      // 如果是分组菜单，传递分组参数
      const url = new URLSearchParams(key.split('?')[1] || '')
      const group = url.get('group')
      if (group) {
        navigate('/connections', { state: { selectedGroup: group } })
      } else {
        navigate('/connections', { state: { selectedGroup: 'All' } })
      }
    } else if (key === '/connections') {
      navigate('/connections', { state: { selectedGroup: 'All' } })
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