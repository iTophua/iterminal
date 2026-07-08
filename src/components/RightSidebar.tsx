import { Button, Tooltip } from 'antd'
import {
  DashboardOutlined,
  FolderOutlined,
  ApiOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  ThunderboltOutlined,
  LinkOutlined,
  MessageOutlined,
  DockerOutlined,
} from '@ant-design/icons'

interface RightSidebarProps {
  connectionId: string | null
  monitorVisible: boolean
  fileManagerVisible: boolean
  apiLogVisible: boolean
  snippetsVisible: boolean
  snippetsEnabled: boolean
  portForwardVisible: boolean
  portForwardEnabled: boolean
  aiChatVisible: boolean
  aiChatEnabled: boolean
  dockerVisible: boolean
  mcpEnabled: boolean
  isFullscreen?: boolean
  showFullscreen?: boolean
  onMonitorToggle: () => void
  onFileManagerToggle: () => void
  onApiLogToggle: () => void
  onSnippetsToggle: () => void
  onPortForwardToggle: () => void
  onAiChatToggle: () => void
  onDockerToggle: () => void
  onFullscreenToggle?: () => void
}

export function RightSidebar({
  connectionId,
  monitorVisible,
  fileManagerVisible,
  apiLogVisible,
  snippetsVisible,
  snippetsEnabled,
  portForwardVisible,
  portForwardEnabled,
  aiChatVisible,
  aiChatEnabled,
  dockerVisible,
  mcpEnabled,
  isFullscreen,
  showFullscreen,
  onMonitorToggle,
  onFileManagerToggle,
  onApiLogToggle,
  onSnippetsToggle,
  onPortForwardToggle,
  onAiChatToggle,
  onDockerToggle,
  onFullscreenToggle,
}: RightSidebarProps) {
  return (
    <div
      className="right-sidebar"
      style={{
        width: 32,
        height: '100%',
        background: 'var(--color-bg-elevated)',
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {showFullscreen && onFullscreenToggle && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '8px 0',
          }}
        >
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏'} placement="left">
            <Button
              type="text"
              size="small"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={onFullscreenToggle}
            />
          </Tooltip>
        </div>
      )}
      {showFullscreen && (
        <div
          style={{
            height: 1,
            background: 'var(--color-border)',
            margin: '0 6px',
          }}
        />
      )}
      <div
        className="right-sidebar-actions"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: showFullscreen ? '8px 0' : '36px 0 8px 0',
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
            <Tooltip title="Docker 管理" placement="left">
              <Button
                type={dockerVisible ? 'primary' : 'text'}
                size="small"
                icon={<DockerOutlined />}
                onClick={onDockerToggle}
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
            {snippetsEnabled && (
              <Tooltip title="命令片段库（Pro）" placement="left">
                <Button
                  type={snippetsVisible ? 'primary' : 'text'}
                  size="small"
                  icon={<ThunderboltOutlined />}
                  onClick={onSnippetsToggle}
                />
              </Tooltip>
            )}
            {portForwardEnabled && (
              <Tooltip title="端口转发（Pro）" placement="left">
                <Button
                  type={portForwardVisible ? 'primary' : 'text'}
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={onPortForwardToggle}
                />
              </Tooltip>
            )}
            {aiChatEnabled && (
              <Tooltip title="AI 对话（Pro）" placement="left">
                <Button
                  type={aiChatVisible ? 'primary' : 'text'}
                  size="small"
                  icon={<MessageOutlined />}
                  onClick={onAiChatToggle}
                />
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  )
}