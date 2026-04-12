import { Layout, Menu, Badge, Tooltip } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { CloudServerOutlined, DesktopOutlined, CodeOutlined, SwapOutlined, SettingOutlined, GithubOutlined } from '@ant-design/icons'
import { useState, useEffect, useMemo } from 'react'
import { useTerminalStore } from '../stores/terminalStore'
import { useTransferStore } from '../stores/transferStore'
import SettingsPanel from './SettingsPanel'
import { STORAGE_KEYS } from '../config/constants'

const { Sider } = Layout

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED)
    return saved ? JSON.parse(saved) : false
  })
  
  const connections = useTerminalStore(state => state.allConnections)
  const connectedCount = useTerminalStore(state => state.connectedConnections.length)
  const transferringCount = useTransferStore(state => state.transferringCount)
  const storeSidebarCollapsed = useTerminalStore(state => state.sidebarCollapsed)
  const setSidebarCollapsed = useTerminalStore(state => state.setSidebarCollapsed)
  const settingsVisible = useTerminalStore(state => state.settingsVisible)
  const setSettingsVisible = useTerminalStore(state => state.setSettingsVisible)

  const groups = useMemo(() => {
    const uniqueGroups = [...new Set(connections.map(c => c.group))]
    return ['全部', ...uniqueGroups]
  }, [connections])

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { '全部': connections.length }
    connections.forEach(c => {
      counts[c.group] = (counts[c.group] || 0) + 1
    })
    return counts
  }, [connections])
  
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, JSON.stringify(collapsed))
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
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>{groupCounts[group]}</span>
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
            <Badge count={connectedCount} size="small" style={{ marginLeft: 8, backgroundColor: 'var(--color-success)' }} />
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
            <Badge count={transferringCount} size="small" style={{ marginLeft: 8, backgroundColor: 'var(--color-info)' }} />
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
      width={160}
      collapsedWidth={48}
      collapsible
      collapsed={collapsed}
      onCollapse={(collapsed) => setCollapsed(collapsed)}
      style={{
        background: 'var(--color-bg-elevated)',
        borderRight: '1px solid var(--color-border)',
        position: 'relative',
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
          borderBottom: '1px solid var(--color-border)',
          cursor: 'pointer'
        }}
        onClick={() => {
          const newState = !collapsed
          setCollapsed(newState)
          setSidebarCollapsed(newState)
        }}
      >
        <span className="text-glow" style={{ color: 'var(--color-primary)', fontSize: 16, fontWeight: 'bold' }}>
          {collapsed ? 'i' : 'iTerminal'}
        </span>
        {!collapsed && (
          <span style={{ color: 'var(--color-text)', fontSize: 16 }}>←</span>
        )}
      </div>
      
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
style={{
           background: 'var(--color-bg-elevated)',
           borderRight: 'none',
           color: 'var(--color-text)'
         }}
        items={menuItems}
        onClick={(e) => handleMenuClick(e.key)}
      />
      
      {/* 底部区域 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--color-bg-elevated)',
        }}
      >
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            padding: collapsed ? '12px 0' : '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            cursor: 'pointer',
          }}
          onClick={() => setSettingsVisible(true)}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-spotlight)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <Tooltip title={collapsed ? '设置' : ''} placement="right">
            <SettingOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }} />
          </Tooltip>
          {!collapsed && (
            <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 10 }}>设置</span>
          )}
        </div>
        
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            padding: collapsed ? '12px 0' : '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <Tooltip title={collapsed ? 'GitHub' : ''} placement="right">
            <a
              href="https://github.com/iTophua/iterminal"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center' }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              <GithubOutlined style={{ fontSize: 16 }} />
            </a>
          </Tooltip>
          {!collapsed && (
            <a
              href="https://github.com/iTophua/iterminal"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-text-tertiary)', marginLeft: 10, fontSize: 14 }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              GitHub
            </a>
          )}
        </div>
      </div>
      
      {/* 设置弹窗 */}
      <SettingsPanel
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      />
    </Sider>
  )
}

export default Sidebar

