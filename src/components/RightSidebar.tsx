import { Button, Tooltip } from 'antd'
import {
  DashboardOutlined,
  FolderOutlined,
  ApiOutlined,
} from '@ant-design/icons'

interface RightSidebarProps {
  connectionId: string | null
  monitorVisible: boolean
  fileManagerVisible: boolean
  apiLogVisible: boolean
  mcpEnabled: boolean
  onMonitorToggle: () => void
  onFileManagerToggle: () => void
  onApiLogToggle: () => void
}

export function RightSidebar({
  connectionId,
  monitorVisible,
  fileManagerVisible,
  apiLogVisible,
  mcpEnabled,
  onMonitorToggle,
  onFileManagerToggle,
  onApiLogToggle,
}: RightSidebarProps) {
  return (
    <div
      style={{
        width: 40,
        height: '100%',
        background: 'var(--color-bg-elevated)',
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '36px 0 8px 0',
          gap: 8,
          background: 'var(--color-bg-elevated)',
        }}
      >
        {connectionId && (
          <>
            <Tooltip title="系统监控" placement="left">
              <Button
                type={monitorVisible ? 'primary' : 'text'}
                size="small"
                icon={<DashboardOutlined />}
                onClick={onMonitorToggle}
              />
            </Tooltip>
            <Tooltip title="文件管理" placement="left">
              <Button
                type={fileManagerVisible ? 'primary' : 'text'}
                size="small"
                icon={<FolderOutlined />}
                onClick={onFileManagerToggle}
              />
            </Tooltip>
            {mcpEnabled && (
              <Tooltip title="MCP 日志" placement="left">
                <Button
                  type={apiLogVisible ? 'primary' : 'text'}
                  size="small"
                  icon={<ApiOutlined />}
                  onClick={onApiLogToggle}
                />
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  )
}