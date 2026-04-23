import { Layout, Menu, Badge } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { CloudServerOutlined, DesktopOutlined, CodeOutlined, SwapOutlined, SettingOutlined, GithubOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useState, useEffect, useMemo } from 'react'
import { open } from '@tauri-apps/plugin-shell'
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

  const mainMenuItems = useMemo(() => [
    { key: 'divider', type: 'divider' as const },
    ...groups.map(group => ({
      key: group === '全部' ? '/connections' : `/connections?group=${encodeURIComponent(group)}`,
      icon: group === '全部' ? <DesktopOutlined /> : <CloudServerOutlined />,
      label: (
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span>{group}</span>
          {groupCounts[group] !== undefined && (
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, opacity: 0.7 }}>{groupCounts[group]}</span>
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

  const bottomMenuItems = useMemo(() => [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
    { key: 'bottom-divider', type: 'divider' as const },
    {
      key: 'github',
      icon: <GithubOutlined />,
      label: 'GitHub',
    },
  ], [])

  const handleMainMenuClick = (key: string) => {
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

  const handleBottomMenuClick = (key: string) => {
    if (key === 'settings') {
      setSettingsVisible(true)
      return
    }
    if (key === 'github') {
      open('https://github.com/iTophua/iterminal').catch(() => {})
      return
    }
  }

  const menuBaseStyle = {
    background: 'var(--color-bg-elevated)',
    borderRight: 'none',
    color: 'var(--color-text)',
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
      }}
      trigger={null}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* 标题和折叠按钮 */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: collapsed ? 0 : '0 16px',
            borderBottom: '1px solid var(--color-border)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={() => {
            const newState = !collapsed
            setCollapsed(newState)
            setSidebarCollapsed(newState)
          }}
        >
          <div className="sidebar-logo" style={{ color: 'var(--color-primary)' }}>
            <div className="sidebar-logo-icon">
              <ThunderboltOutlined />
            </div>
            {!collapsed && (
              <span className="gradient-text" style={{ fontSize: 16, fontWeight: 700 }}>
                iTerminal
              </span>
            )}
          </div>
          {!collapsed && (
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 13, transition: 'transform 0.3s ease', transform: collapsed ? 'rotate(180deg)' : 'none' }}>←</span>
          )}
        </div>

        {/* 主导航菜单 */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={menuBaseStyle}
            items={mainMenuItems}
            onClick={(e) => handleMainMenuClick(e.key)}
          />
        </div>

        {/* 底部分隔线 */}
        <div style={{ borderTop: '1px solid var(--color-border)', margin: '0 12px' }} />

        {/* 底部菜单：设置 + GitHub */}
        <div style={{ flexShrink: 0 }}>
          <Menu
            mode="inline"
            selectedKeys={[]}
            style={menuBaseStyle}
            items={bottomMenuItems}
            onClick={(e) => handleBottomMenuClick(e.key)}
          />
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
