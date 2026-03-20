import { Tooltip, Input, Button, App } from 'antd'
import {
  ScissorOutlined,
  ExportOutlined,
  ClearOutlined,
  SearchOutlined,
  FullscreenOutlined,
  SplitCellsOutlined,
  DashboardOutlined,
  FolderOutlined,
  ApiOutlined,
  PushpinOutlined,
  ToolOutlined,
  LeftOutlined,
  RightOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { ShortcutSettings } from '../../../stores/terminalStore'

interface TerminalToolbarProps {
  sessionKey: string
  connectionName: string
  terminalInstances: React.MutableRefObject<{ [key: string]: any }>
  toolbarState: 'full' | 'ball'
  autoHideToolbar: boolean
  mouseOverBall: boolean
  searchVisible: boolean
  isFullscreen: boolean
  mcpEnabled: boolean
  rightPanelWidth: number
  shortcutSettings: ShortcutSettings
  onShowSearch: () => void
  onToggleFullscreen: (key: string) => void
  onSplit: () => void
  onOpenMonitor: () => void
  onOpenFileManager: () => void
  onToggleApiLog: () => void
  onToggleAutoHide: () => void
  onMouseLeave: () => void
  onMouseEnterBall: () => void
  setSearchText: (text: string) => void
  handleSearch: (direction: 'next' | 'prev') => void
  closeSearch: () => void
  searchText: string
}

export function TerminalToolbar({
  sessionKey,
  connectionName,
  terminalInstances,
  toolbarState,
  autoHideToolbar,
  mouseOverBall,
  searchVisible,
  isFullscreen,
  mcpEnabled,
  rightPanelWidth,
  shortcutSettings,
  onShowSearch,
  onToggleFullscreen,
  onSplit,
  onOpenMonitor,
  onOpenFileManager,
  onToggleApiLog,
  onToggleAutoHide,
  onMouseLeave,
  onMouseEnterBall,
  setSearchText,
  handleSearch,
  closeSearch,
  searchText,
}: TerminalToolbarProps) {
  const { message } = App.useApp()

  const handleCopy = async () => {
    const term = terminalInstances.current[sessionKey]
    if (term) {
      const selection = term.getSelection()
      if (selection) {
        await writeText(selection)
        message.success('已复制')
      } else {
        message.info('请先选择要复制的内容')
      }
    }
  }

  const handleExport = async () => {
    const term = terminalInstances.current[sessionKey]
    if (!term) return

    const content = term.getSelection() || ''
    if (!content) {
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) || '')
      }
      const fullContent = lines.join('\n')
      if (fullContent.trim()) {
        const blob = new Blob([fullContent], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `terminal-${connectionName}-${new Date().toISOString().slice(0, 10)}.txt`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        message.success('已导出终端输出')
      } else {
        message.info('终端无内容可导出')
      }
    } else {
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `terminal-selection-${connectionName}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      message.success('已导出选中内容')
    }
  }

  const handleClear = () => {
    const term = terminalInstances.current[sessionKey]
    if (term) {
      term.clear()
      message.success('已清屏')
    }
  }

  const baseStyle: React.CSSProperties = {
    position: 'fixed',
    top: 90,
    right: 8 + rightPanelWidth,
    zIndex: 100,
    transition: 'right 0.3s ease',
  }

  const showFullToolbar = (toolbarState === 'full' && (!autoHideToolbar || mouseOverBall)) || searchVisible

  if (showFullToolbar) {
    return (
      <>
        <div
          style={{
            ...baseStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'var(--color-bg-elevated)',
            borderRadius: 6,
            padding: '4px 8px',
            boxShadow: 'var(--shadow-md)',
          }}
          onMouseLeave={onMouseLeave}
        >
          <Tooltip title="复制选中内容">
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={handleCopy}
            >
              <ScissorOutlined />
            </span>
          </Tooltip>
          <Tooltip title="导出终端输出">
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={handleExport}
            >
              <ExportOutlined />
            </span>
          </Tooltip>
          <Tooltip title={`清屏 (${shortcutSettings.clearScreen})`}>
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={handleClear}
            >
              <ClearOutlined />
            </span>
          </Tooltip>
          <Tooltip title="搜索">
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={onShowSearch}
            >
              <SearchOutlined />
            </span>
          </Tooltip>
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏'}>
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={() => onToggleFullscreen(sessionKey)}
            >
              <FullscreenOutlined />
            </span>
          </Tooltip>
          <Tooltip title="水平分屏">
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={onSplit}
            >
              <SplitCellsOutlined />
            </span>
          </Tooltip>
          <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 4px' }} />
          <Tooltip title="系统监控">
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={onOpenMonitor}
            >
              <DashboardOutlined />
            </span>
          </Tooltip>
          <Tooltip title="文件管理">
            <span
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
              onClick={onOpenFileManager}
            >
              <FolderOutlined />
            </span>
          </Tooltip>
          {mcpEnabled && (
            <Tooltip title="MCP 日志">
              <span
                style={{ color: '#999', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
                onClick={onToggleApiLog}
              >
                <ApiOutlined />
              </span>
            </Tooltip>
          )}
          <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 4px' }} />
          <Tooltip title={autoHideToolbar ? '固定工具栏' : '自动隐藏'}>
            <span
              style={{ color: autoHideToolbar ? 'var(--color-text-quaternary)' : 'var(--color-primary)', cursor: 'pointer', padding: '4px 6px', fontSize: 12 }}
              onClick={onToggleAutoHide}
            >
              <PushpinOutlined />
            </span>
          </Tooltip>
        </div>

        {searchVisible && (
          <div
            style={{
              ...baseStyle,
              top: 128,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--color-bg-elevated)',
              borderRadius: 6,
              padding: '6px 8px',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <Input
              size="small"
              placeholder="搜索..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onPressEnter={() => handleSearch('next')}
              style={{ width: 150, background: 'var(--color-bg-container)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
            <Tooltip title="上一个">
              <Button size="small" icon={<LeftOutlined />} onClick={() => handleSearch('prev')} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' }} />
            </Tooltip>
            <Tooltip title="下一个">
              <Button size="small" icon={<RightOutlined />} onClick={() => handleSearch('next')} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' }} />
            </Tooltip>
            <Tooltip title="关闭">
              <Button size="small" icon={<CloseOutlined />} onClick={closeSearch} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' }} />
            </Tooltip>
          </div>
        )}
      </>
    )
  }

  return (
    <Tooltip title={autoHideToolbar ? '悬停展开工具栏' : '展开工具栏'}>
      <div
        onMouseEnter={onMouseEnterBall}
        onClick={() => {
          if (!autoHideToolbar) {
            onMouseEnterBall()
          }
        }}
        style={{
          ...baseStyle,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--color-bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: autoHideToolbar ? 'default' : 'pointer',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <ToolOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }} />
      </div>
    </Tooltip>
  )
}