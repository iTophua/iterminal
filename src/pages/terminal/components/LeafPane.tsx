import React, { useCallback } from 'react'
import { Tabs, Spin } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import { App } from 'antd'
import { SearchAddon } from '@xterm/addon-search'
import type { SplitPane, ConnectedConnection } from '../../../stores/terminalStore'
import type { TerminalThemeColors } from '../../../types/theme'
import { useTerminalStore } from '../../../stores/terminalStore'
import { hasSplitChildren } from '../../../utils/paneUtils'
import { PaneToolbar, DraggableSessionTab } from './index'
import { GhostTextOverlay } from '../../../components/GhostTextOverlay'

interface LeafPaneProps {
  pane: SplitPane
  connectionId: string
  connection: ConnectedConnection | undefined
  currentThemeColors: TerminalThemeColors
  activeSearchSessionKey: string | null
  searchText: string
  searchMode: 'normal' | 'regex' | 'wholeWord'
  dropTarget: { paneId: string; connectionId: string; direction: 'left' | 'right' | 'top' | 'bottom' } | null
  terminalRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  ghostTextElementsRef: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  paneRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  searchAddons: React.MutableRefObject<Record<string, SearchAddon>>
  terminalInstances: React.MutableRefObject<Record<string, any>>
  onCloseSession: (connId: string, sessId: string, paneId?: string) => void
  onReconnect: (connectionId: string, isManual: boolean) => void
  onContextMenu: (e: React.MouseEvent, sessionKey: string) => void
  onSetActiveSearchSessionKey: (key: string | null) => void
  onSetSearchText: (text: string) => void
  onSetSearchMode: (mode: 'normal' | 'regex' | 'wholeWord') => void
  onSessionDragStart: (sessionId: string, connectionId: string, title: string) => void
  onCloseSplitPane: (connectionId: string, paneId: string, paneSessions: { id: string; shellId?: string }[]) => void
}

function areEqual(prevProps: LeafPaneProps, nextProps: LeafPaneProps): boolean {
  // pane 核心字段比较
  if (prevProps.pane.id !== nextProps.pane.id) return false
  if (prevProps.pane.activeSessionId !== nextProps.pane.activeSessionId) return false
  if (prevProps.pane.sessions !== nextProps.pane.sessions) return false

  // connectionId
  if (prevProps.connectionId !== nextProps.connectionId) return false

  // connection 关键状态字段（不比较整个对象引用）
  const prevConn = prevProps.connection
  const nextConn = nextProps.connection
  if (prevConn?.disconnected !== nextConn?.disconnected) return false
  if (prevConn?.reconnecting !== nextConn?.reconnecting) return false
  if (prevConn?.initializing !== nextConn?.initializing) return false
  if (prevConn?.reconnectAttempt !== nextConn?.reconnectAttempt) return false
  if (prevConn?.rootPane !== nextConn?.rootPane) return false

  // 搜索状态
  if (prevProps.activeSearchSessionKey !== nextProps.activeSearchSessionKey) return false
  if (prevProps.searchText !== nextProps.searchText) return false
  if (prevProps.searchMode !== nextProps.searchMode) return false

  // 主题
  if (prevProps.currentThemeColors !== nextProps.currentThemeColors) return false

  // dropTarget
  if (prevProps.dropTarget !== nextProps.dropTarget) return false

  // 不比较 refs 和 callbacks，它们应由父组件保持稳定
  // 如果父组件传递新的 callbacks，说明父组件已重渲染，LeafPane 也应更新

  return true
}

export const LeafPane = React.memo(function LeafPane({
  pane,
  connectionId,
  connection,
  currentThemeColors,
  activeSearchSessionKey,
  searchText,
  searchMode,
  dropTarget,
  terminalRefs,
  ghostTextElementsRef,
  paneRefs,
  searchAddons,
  terminalInstances,
  onCloseSession,
  onReconnect,
  onContextMenu,
  onSetActiveSearchSessionKey,
  onSetSearchText,
  onSetSearchMode,
  onSessionDragStart,
  onCloseSplitPane,
}: LeafPaneProps) {
  const { message } = App.useApp()
  const terminalSettings = useTerminalStore((state: any) => state.terminalSettings)
  const shortcutSettings = useTerminalStore((state: any) => state.shortcutSettings)
  const splitPane = useTerminalStore((state: any) => state.splitPane)
  const addSessionToPane = useTerminalStore((state: any) => state.addSessionToPane)
  const setActiveSessionInPane = useTerminalStore((state: any) => state.setActiveSessionInPane)

  const activeSessRaw = pane.activeSessionId
    ? pane.sessions.find(s => s.id === pane.activeSessionId)
    : pane.sessions[0]

  const handleAddSessionToPane = useCallback(async () => {
    try {
      const shellId = await invoke<string>('get_shell', { id: connectionId })
      addSessionToPane(connectionId, pane.id, shellId)
      message.success('会话已创建')
    } catch (err) {
      message.error(`创建失败: ${err}`)
    }
  }, [connectionId, pane.id, addSessionToPane, message])

  const handleSplitHorizontal = useCallback(async () => {
    try {
      const newShellId = await invoke<string>('get_shell', { id: connectionId })
      const newPaneId = Date.now().toString()
      splitPane(connectionId, pane.id, 'horizontal', newPaneId, newShellId)
    } catch (err) {
      message.error(`分屏失败: ${err}`)
    }
  }, [connectionId, pane.id, splitPane, message])

  const handleSplitVertical = useCallback(async () => {
    try {
      const newShellId = await invoke<string>('get_shell', { id: connectionId })
      const newPaneId = Date.now().toString()
      splitPane(connectionId, pane.id, 'vertical', newPaneId, newShellId)
    } catch (err) {
      message.error(`分屏失败: ${err}`)
    }
  }, [connectionId, pane.id, splitPane, message])

  const handleCloseSplit = useCallback(async () => {
    if (!connection || !hasSplitChildren(connection.rootPane)) return
    onCloseSplitPane(connectionId, pane.id, pane.sessions)
  }, [connection, connectionId, pane.id, pane.sessions, onCloseSplitPane])

  const handleClear = useCallback(() => {
    if (!activeSessRaw) return
    const term = terminalInstances.current[`${connectionId}_${activeSessRaw.id}`]
    if (term) term.clear()
  }, [connectionId, activeSessRaw, terminalInstances])

  const handleExport = useCallback(() => {
    if (!activeSessRaw) return
    const term = terminalInstances.current[`${connectionId}_${activeSessRaw.id}`]
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
        a.download = `terminal-${new Date().toISOString().slice(0, 10)}.txt`
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
      a.download = `terminal-selection.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      message.success('已导出选中内容')
    }
  }, [connectionId, activeSessRaw?.id, terminalInstances, message])

  if (!activeSessRaw) return null
  const activeSess = activeSessRaw

  const sessionTabItems = pane.sessions.map(s => ({
    key: s.id,
    label: (
      <DraggableSessionTab
        sessionId={s.id}
        connectionId={connectionId}
        title={s.title}
        onClose={() => onCloseSession(connectionId, s.id, pane.id)}
        onDragStart={onSessionDragStart}
        isDisconnected={connection?.disconnected}
      />
    ),
    children: (
      <div style={{ position: 'relative', height: '100%' }}>
        <div
          ref={el => { terminalRefs.current[`${connectionId}_${s.id}`] = el }}
          style={{
            height: '100%',
            background: 'var(--color-bg-container)',
            overflow: 'hidden',
            boxSizing: 'border-box',
            padding: 4,
          }}
          onContextMenu={(e) => onContextMenu(e, `${connectionId}_${s.id}`)}
          onClick={() => setActiveSessionInPane(connectionId, pane.id, s.id)}
        />
        <GhostTextOverlay
          sessionKey={`${connectionId}_${s.id}`}
          fontFamily={terminalSettings.fontFamily}
          fontSize={terminalSettings.fontSize}
          themeColors={currentThemeColors}
          ref={(el) => { ghostTextElementsRef.current[`${connectionId}_${s.id}`] = el }}
        />
        {connection?.initializing && s.id === activeSess.id && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: 'var(--color-bg-container)',
              zIndex: 5,
            }}
          >
            <Spin size="default" />
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>
              正在初始化终端...
            </span>
          </div>
        )}
      </div>
    ),
  }))

  const currentSearchKey = `${connectionId}_${activeSess.id}`
  const searchVisible = activeSearchSessionKey === currentSearchKey

  return (
    <div
      ref={el => { if (el) paneRefs.current.set(`${connectionId}::${pane.id}`, el) }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-container)', position: 'relative' }}
    >
      {/* 分屏高亮指示器 */}
      {dropTarget && dropTarget.paneId === pane.id && dropTarget.connectionId === connectionId && (
        <div
          style={{
            position: 'absolute',
            background: 'rgba(0, 185, 107, 0.3)',
            border: '2px dashed var(--color-primary)',
            zIndex: 10,
            pointerEvents: 'none',
            ...(dropTarget.direction === 'left' && { left: 0, top: 0, width: '50%', height: '100%' }),
            ...(dropTarget.direction === 'right' && { right: 0, top: 0, width: '50%', height: '100%' }),
            ...(dropTarget.direction === 'top' && { left: 0, top: 0, width: '100%', height: '50%' }),
            ...(dropTarget.direction === 'bottom' && { left: 0, bottom: 0, width: '100%', height: '50%' }),
          }}
        />
      )}

      {/* 连接断开横幅 */}
      {connection?.disconnected && (
        <div className="disconnect-banner">
          <span>
            ⚠️ 连接已断开 {connection.reconnecting ? `(重连中... 尝试 ${connection.reconnectAttempt || 1})` : '— 按回车键或点击按钮重连'}
          </span>
          {!connection.reconnecting && (
            <button onClick={() => onReconnect(connectionId, true)}>
              立即重连
            </button>
          )}
        </div>
      )}

      <PaneToolbar
        sessionKey={currentSearchKey}
        searchAddons={searchAddons}
        shortcutSettings={shortcutSettings}
        hasSplitPanel={hasSplitChildren(connection?.rootPane || null)}
        searchVisible={searchVisible}
        searchText={searchText}
        searchMode={searchMode}
        onToggleSearch={() => {
          onSetActiveSearchSessionKey(searchVisible ? null : currentSearchKey)
        }}
        onSearchTextChange={onSetSearchText}
        onSearchModeChange={onSetSearchMode}
        onSplitHorizontal={handleSplitHorizontal}
        onSplitVertical={handleSplitVertical}
        onCloseSplit={handleCloseSplit}
        onClear={handleClear}
        onExport={handleExport}
      />

      <Tabs
        activeKey={activeSess.id}
        onChange={sid => {
          if (sid === '__add__') return
          setActiveSessionInPane(connectionId, pane.id, sid)
        }}
        items={[
          ...sessionTabItems,
          {
            key: '__add__',
            label: <span style={{ color: 'var(--color-primary)', fontSize: 12 }}><PlusOutlined /> 新建</span>,
            children: <div />
          }
        ]}
        type="card"
        style={{ flex: '0 0 auto' }}
        tabBarStyle={{ margin: 0, padding: '0 4px', background: 'var(--color-bg-container)', minHeight: 24, height: 24 }}
        onTabClick={(key) => { if (key === '__add__') handleAddSessionToPane() }}
        destroyInactiveTabPane={false}
        size="small"
      />
    </div>
  )
}, areEqual)
