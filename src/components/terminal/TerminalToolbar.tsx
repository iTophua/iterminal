import { Button, Tooltip, Dropdown } from 'antd'
import { 
  SearchOutlined, 
  DisconnectOutlined, 
  FolderOutlined,
  MonitorOutlined,
  BorderHorizontalOutlined,
  BorderVerticleOutlined,
} from '@ant-design/icons'

interface TerminalToolbarProps {
  title?: string
  showFileManager: boolean
  showMonitor: boolean
  showSplit?: boolean
  onToggleFileManager: () => void
  onToggleMonitor: () => void
  onToggleSearch: () => void
  onDisconnect: () => void
  onSplit?: (direction: 'horizontal' | 'vertical') => void
}

export function TerminalToolbar({
  title,
  showFileManager,
  showMonitor,
  showSplit = true,
  onToggleFileManager,
  onToggleMonitor,
  onToggleSearch,
  onDisconnect,
  onSplit,
}: TerminalToolbarProps) {
  const splitMenuItems = [
    { key: 'horizontal', label: '水平分屏', icon: <BorderHorizontalOutlined /> },
    { key: 'vertical', label: '垂直分屏', icon: <BorderVerticleOutlined /> },
  ]

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '4px 12px',
      background: 'var(--color-bg-elevated)',
      borderBottom: '1px solid var(--color-border)',
      gap: 8,
    }}>
      {title && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13 }}>{title}</span>
        </div>
      )}
      
      {showSplit && onSplit && (
        <Dropdown menu={{ 
          items: splitMenuItems,
          onClick: ({ key }) => onSplit(key as 'horizontal' | 'vertical')
        }}>
          <Tooltip title="分屏">
            <Button type="text" size="small" icon={<BorderHorizontalOutlined />} />
          </Tooltip>
        </Dropdown>
      )}
      
      <Tooltip title="文件管理">
        <Button
          type="text"
          size="small"
          icon={<FolderOutlined />}
          onClick={onToggleFileManager}
          style={{ color: showFileManager ? 'var(--color-primary)' : undefined }}
        />
      </Tooltip>
      
      <Tooltip title="系统监控">
        <Button
          type="text"
          size="small"
          icon={<MonitorOutlined />}
          onClick={onToggleMonitor}
          style={{ color: showMonitor ? 'var(--color-primary)' : undefined }}
        />
      </Tooltip>
      
      <Tooltip title="搜索">
        <Button
          type="text"
          size="small"
          icon={<SearchOutlined />}
          onClick={onToggleSearch}
        />
      </Tooltip>
      
      <Tooltip title="断开连接">
        <Button
          type="text"
          size="small"
          danger
          icon={<DisconnectOutlined />}
          onClick={onDisconnect}
        />
      </Tooltip>
    </div>
  )
}