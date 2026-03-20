import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Tabs, App, Button } from 'antd'
import {
  CloseOutlined,
  PlusOutlined,
  HolderOutlined,
  DisconnectOutlined,
  ReloadOutlined,
  CopyOutlined,
  SnippetsOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  BorderHorizontalOutlined,
  BorderVerticleOutlined,
} from '@ant-design/icons'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Panel, Group } from 'react-resizable-panels'
import 'xterm/css/xterm.css'
import { useTerminalStore, DisconnectedConnection, SplitPane, Session } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { resolveTerminalTheme } from '../styles/themes/terminal-themes'
import { RightSidebar } from '../components/RightSidebar'
import MonitorPanel from '../components/MonitorPanel'
import FileManagerPanel from '../components/FileManagerPanel'
import McpLogPanel from '../components/McpLogPanel'
import { STORAGE_KEYS } from '../config/constants'
import { useToolbarState, useFullscreen, useTerminalSearch, useContextMenu, useRightPanels } from './terminal/hooks'
import { TerminalToolbar } from './terminal/components'

interface SortableTabProps {
  id: string
  label: React.ReactNode
}

function SortableTab({ id, label }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }

  return (
    <span ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <HolderOutlined style={{ fontSize: 10, color: 'var(--color-text-quaternary)', cursor: 'grab' }} />
      {label}
    </span>
  )
}

interface DraggableSessionTabProps {
  sessionId: string
  connectionId: string
  title: string
  onClose: () => void
  onDragStart: (sessionId: string, connectionId: string) => void
}

function DraggableSessionTab({ sessionId, connectionId, title, onClose, onDragStart }: DraggableSessionTabProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('sessionId', sessionId)
    e.dataTransfer.setData('connectionId', connectionId)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(sessionId, connectionId)
  }

  return (
    <span
      draggable
      onDragStart={handleDragStart}
      style={{ fontSize: 12, cursor: 'grab', display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <HolderOutlined style={{ fontSize: 10, color: 'var(--color-text-quaternary)' }} />
      {title}
      <CloseOutlined
        style={{ marginLeft: 6, fontSize: 10, cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); onClose() }}
      />
    </span>
  )
}

function getAllSessions(pane: SplitPane): Session[] {
  if (pane.children) {
    return pane.children.flatMap(child => getAllSessions(child))
  }
  return pane.sessions
}

function getActiveSessionInPane(pane: SplitPane): Session | null {
  if (pane.children) {
    for (const child of pane.children) {
      const active = getActiveSessionInPane(child)
      if (active) return active
    }
    return null
  }
  if (pane.activeSessionId) {
    return pane.sessions.find(s => s.id === pane.activeSessionId) || null
  }
  return pane.sessions[0] || null
}

function findPaneBySessionId(pane: SplitPane, sessionId: string): SplitPane | null {
  if (pane.sessions.some(s => s.id === sessionId)) {
    return pane
  }
  if (pane.children) {
    for (const child of pane.children) {
      const found = findPaneBySessionId(child, sessionId)
      if (found) return found
    }
  }
  return null
}

function hasSplitChildren(pane: SplitPane): boolean {
  return !!(pane.children && pane.children.length > 0)
}

function getVisibleSessions(pane: SplitPane): Session[] {
  if (pane.children && pane.children.length > 0) {
    return pane.children.flatMap(child => getVisibleSessions(child))
  }
  return pane.sessions
}

function Terminal() {
  const { message } = App.useApp()
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const disconnectedConnections = useTerminalStore(state => state.disconnectedConnections)
  const activeConnectionId = useTerminalStore(state => state.activeConnectionId)
  const setActiveConnection = useTerminalStore(state => state.setActiveConnection)
  const setActiveSession = useTerminalStore(state => state.setActiveSession)
  const addSession = useTerminalStore(state => state.addSession)
  const closeSession = useTerminalStore(state => state.closeSession)
  const closeConnection = useTerminalStore(state => state.closeConnection)
  const markConnectionDisconnected = useTerminalStore(state => state.markConnectionDisconnected)
  const removeDisconnectedConnection = useTerminalStore(state => state.removeDisconnectedConnection)
  const addConnection = useTerminalStore(state => state.addConnection)
  const splitPane = useTerminalStore(state => state.splitPane)
  const closePane = useTerminalStore(state => state.closePane)
  const addSessionToPane = useTerminalStore(state => state.addSessionToPane)
  const closeSessionInPane = useTerminalStore(state => state.closeSessionInPane)
  const setActiveSessionInPane = useTerminalStore(state => state.setActiveSessionInPane)
  const setSidebarCollapsed = useTerminalStore(state => state.setSidebarCollapsed)
  const fileManagerVisible = useTerminalStore(state => state.fileManagerVisible)
  const setFileManagerVisible = useTerminalStore(state => state.setFileManagerVisible)
  const terminalSettings = useTerminalStore(state => state.terminalSettings)
  const shortcutSettings = useTerminalStore(state => state.shortcutSettings)
  const reorderConnections = useTerminalStore(state => state.reorderConnections)
  const terminalThemeKey = useThemeStore(state => state.terminalTheme)
  const appTheme = useThemeStore(state => state.appTheme)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const terminalInstances = useRef<{ [key: string]: XTerm }>({})
  const fitAddons = useRef<{ [key: string]: FitAddon }>({})
  const initializedRef = useRef<Set<string>>(new Set())
  const unlistenersRef = useRef<{ [key: string]: UnlistenFn }>({})
  const resizeObserversRef = useRef<{ [key: string]: ResizeObserver }>({})
  const searchAddons = useRef<{ [key: string]: SearchAddon }>({})
  const apiLogVisibleRef = useRef(false)
  
  // 使用提取的 hooks
  const {
    toolbarState,
    autoHideToolbar,
    mouseOverBall,
    setAutoHideToolbar,
    setToolbarState,
    setMouseOverBall,
  } = useToolbarState()

  const {
    isFullscreen,
    handleToggleFullscreen,
  } = useFullscreen(fitAddons, setSidebarCollapsed)

  const {
    searchVisible,
    searchText,
    setSearchText,
    handleSearch,
    setSearchVisible,
  } = useTerminalSearch(searchAddons, connectedConnections, activeConnectionId)

  const {
    contextMenu,
    handleContextMenu,
    hideContextMenu,
  } = useContextMenu()

  const {
    monitorVisible,
    setMonitorVisible,
    apiLogVisible,
    setApiLogVisible,
    rightPanelWidth,
    prevPanelWidthRef,
  } = useRightPanels(activeConnectionId, fileManagerVisible, setFileManagerVisible)
  
  const [mcpEnabled, setMcpEnabled] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MCP_ENABLED)
    return saved ? saved === 'true' : false
  })

  const [draggedSession, setDraggedSession] = useState<{ sessionId: string; connectionId: string } | null>(null)
  const [dropIndicator, setDropIndicator] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null)

  // 同步 ref
  useEffect(() => {
    apiLogVisibleRef.current = apiLogVisible
  }, [apiLogVisible])

  // MCP 状态同步
  useEffect(() => {
    const handleMcpStatusChange = (e: CustomEvent<boolean>) => {
      setMcpEnabled(e.detail)
      if (!e.detail && apiLogVisibleRef.current) {
        setApiLogVisible(false)
      }
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.MCP_ENABLED && e.newValue !== null) {
        setMcpEnabled(e.newValue === 'true')
      }
    }

    window.addEventListener('mcp-status-change', handleMcpStatusChange as EventListener)
    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('mcp-status-change', handleMcpStatusChange as EventListener)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])
  
  useEffect(() => {
    const newTheme = resolveTerminalTheme(appTheme, terminalThemeKey)
    const instances = Object.values(terminalInstances.current)
    for (let i = 0; i < instances.length; i++) {
      const term = instances[i]
      if (term) {
        term.options.theme = newTheme
        term.refresh(0, term.rows - 1)
      }
    }
  }, [terminalThemeKey, appTheme])
  
  const activeConnection = connectedConnections.find(c => c.connectionId === activeConnectionId)
  const activeSession = activeConnection ? getActiveSessionInPane(activeConnection.rootPane) : null
  const visibleSessions = activeConnection ? getVisibleSessions(activeConnection.rootPane) : []

  useEffect(() => {
    if (!activeConnection) return

    const sessionsToInit = visibleSessions
    
    for (const session of sessionsToInit) {
      if (!session.shellId) continue

      const key = `${session.connectionId}_${session.id}`
      const shellId = session.shellId

      if (initializedRef.current.has(key)) {
        const term = terminalInstances.current[key]
        const container = terminalRefs.current[key]

        if (term && container && term.element && !container.contains(term.element)) {
          container.innerHTML = ''
          container.appendChild(term.element)
          requestAnimationFrame(() => {
            try { term.focus() } catch {}
          })
        }

        const addon = fitAddons.current[key]
        if (addon) requestAnimationFrame(() => { try { addon.fit() } catch {} })
        continue
      }

      const container = terminalRefs.current[key]
      if (!container) continue

      const initTerminal = async () => {
        const waitForContainerSize = (): Promise<void> => {
          return new Promise((resolve) => {
            const checkSize = () => {
              const rect = container.getBoundingClientRect()
              if (rect.width > 0 && rect.height > 0) {
                resolve()
              } else {
                requestAnimationFrame(checkSize)
              }
            }
            checkSize()
          })
        }

        await waitForContainerSize()

        const terminal = new XTerm({
          cursorBlink: terminalSettings.cursorBlink,
          cursorStyle: terminalSettings.cursorStyle,
          fontSize: terminalSettings.fontSize,
          fontFamily: `${terminalSettings.fontFamily}, Menlo, Monaco, "Courier New", monospace`,
          theme: resolveTerminalTheme(appTheme, terminalThemeKey),
          convertEol: true,
          disableStdin: false,
          scrollback: terminalSettings.scrollback,
        })

        const fitAddon = new FitAddon()
        terminal.loadAddon(fitAddon)
        container.innerHTML = ''
        terminal.open(container)

        const textarea = terminal.element?.querySelector('textarea')
        if (textarea) {
          textarea.addEventListener('paste', (e: Event) => {
            e.preventDefault()
            e.stopPropagation()
          }, true)
        }

        const matchShortcut = (event: KeyboardEvent, shortcut: string): boolean => {
          const parts = shortcut.toUpperCase().split('+')
          const hasCtrl = parts.includes('CTRL')
          const hasShift = parts.includes('SHIFT')
          const hasAlt = parts.includes('ALT')
          const hasMeta = parts.includes('META')
          const keyPart = parts.find(p => !['CTRL', 'SHIFT', 'ALT', 'META'].includes(p))
          
          const ctrlMatch = hasCtrl ? (event.ctrlKey || event.metaKey) : (!event.ctrlKey || event.metaKey)
          const shiftMatch = hasShift ? event.shiftKey : !event.shiftKey
          const altMatch = hasAlt ? event.altKey : !event.altKey
          const metaMatch = hasMeta ? event.metaKey : true
          const keyMatch = keyPart ? event.key.toUpperCase() === keyPart : false
          
          return ctrlMatch && shiftMatch && altMatch && metaMatch && keyMatch
        }

        terminal.attachCustomKeyEventHandler(event => {
          if (event.type !== 'keydown') return true
          
          if (matchShortcut(event, shortcutSettings.clearScreen)) {
            terminal.clear()
            return false
          }
          
          if (matchShortcut(event, shortcutSettings.search)) {
            setSearchVisible(prev => !prev)
            return false
          }
          
          if (matchShortcut(event, shortcutSettings.paste)) {
            terminal.clearSelection()
            readText().then(text => {
              if (text) {
                invoke('write_shell', { id: shellId, data: text }).catch(err => {
                  console.error('写入终端失败:', err)
                })
              }
            }).catch(err => {
              console.error('粘贴失败:', err)
              message.error('粘贴失败')
            })
            return false
          }
          
          return true
        })

        terminal.onData(data => {
          invoke('write_shell', { id: shellId, data }).catch(err => {
            console.error('写入终端失败:', err)
          })
        })

        terminal.onResize(({ cols, rows }) => {
          invoke('resize_shell', { id: shellId, cols, rows }).catch(err => {
            console.error('调整终端大小失败:', err)
          })
        })

        terminal.onSelectionChange(() => {
          if (terminalSettings.copyOnSelect && terminal.hasSelection()) {
            const selection = terminal.getSelection()
            if (selection) {
              writeText(selection).catch(err => {
                console.error('复制失败:', err)
              })
            }
          }
        })

        terminalInstances.current[key] = terminal
        fitAddons.current[key] = fitAddon

        const searchAddon = new SearchAddon()
        terminal.loadAddon(searchAddon)
        searchAddons.current[key] = searchAddon

        const eventName = `shell-output-${shellId}`
        const unlisten = await listen<string>(eventName, (event) => {
          const term = terminalInstances.current[key]
          if (term && event.payload) {
            if (typeof event.payload === 'object' && (event.payload as any).eof) {
              return
            }
            term.write(event.payload)
          }
        })

        unlistenersRef.current[key] = unlisten

        let rafId: number | null = null
        const resizeObserver = new ResizeObserver(() => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId)
          }
          rafId = requestAnimationFrame(() => {
            const addon = fitAddons.current[key]
            if (addon) {
              try { addon.fit() } catch {}
            }
            rafId = null
          })
        })
        resizeObserver.observe(container)
        resizeObserversRef.current[key] = resizeObserver

        requestAnimationFrame(() => {
          try { fitAddon.fit() } catch {}
          try { terminal.focus() } catch {}
        })

        initializedRef.current.add(key)

        try {
          await invoke('start_shell_reader', { id: shellId })
        } catch (err) {
          console.error('启动终端读取器失败:', err)
          message.error('启动终端失败，请重试')
        }
      }

      initTerminal().catch(err => {
        console.error('终端初始化失败:', err)
        message.error('终端初始化失败')
      })
    }
  }, [visibleSessions, terminalSettings, shortcutSettings, appTheme, terminalThemeKey, message, activeConnection])

  const disconnectListenersRef = useRef<{ [key: string]: UnlistenFn }>({})

  useEffect(() => {
    const currentIds = new Set(connectedConnections.map(c => c.connectionId))
    
    Object.keys(disconnectListenersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        disconnectListenersRef.current[id]()
        delete disconnectListenersRef.current[id]
      }
    })
    
    connectedConnections.forEach(conn => {
      const eventName = `connection-disconnected-${conn.connectionId}`
      if (!disconnectListenersRef.current[conn.connectionId]) {
        listen<{ reason: string; shell_id: string }>(eventName, (event) => {
          const reason = event.payload.reason as DisconnectedConnection['reason']
          markConnectionDisconnected(conn.connectionId, reason)
          message.warning(`连接 ${conn.connection.name} 已断开`)
        }).then(unlisten => {
          disconnectListenersRef.current[conn.connectionId] = unlisten
        })
      }
    })

    return () => {
      Object.values(disconnectListenersRef.current).forEach(unlisten => unlisten())
      disconnectListenersRef.current = {}
    }
  }, [connectedConnections, markConnectionDisconnected, message])

  const handleReconnect = useCallback(async (disconnectedConn: DisconnectedConnection) => {
    try {
      await invoke('connect_ssh', {
        id: disconnectedConn.connectionId,
        connection: {
          host: disconnectedConn.connection.host,
          port: disconnectedConn.connection.port,
          username: disconnectedConn.connection.username,
          password: disconnectedConn.connection.password,
          key_file: disconnectedConn.connection.keyFile,
        }
      })

      const shellId = await invoke<string>('get_shell', { id: disconnectedConn.connectionId })
      
      removeDisconnectedConnection(disconnectedConn.connectionId)
      
      addConnection(disconnectedConn.connection, shellId)
      
      message.success('重连成功')
    } catch (err) {
      message.error(`重连失败: ${err}`)
    }
  }, [addConnection, removeDisconnectedConnection, message])

  const handleRemoveDisconnected = useCallback((connectionId: string) => {
    removeDisconnectedConnection(connectionId)
  }, [removeDisconnectedConnection])


  // 新建会话
  const handleAddSession = useCallback(async (connectionId: string) => {
    if (!connectionId) return
    try {
      const shellId = await invoke<string>('get_shell', { id: connectionId })
      addSession(connectionId, shellId)
      message.success('会话已创建')
    } catch (err) {
      message.error(`创建失败: ${err}`)
    }
  }, [addSession])

  const handleCloseSession = useCallback(async (connId: string, sessId: string, paneId?: string) => {
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn) return
    
    const allSessions = getAllSessions(conn.rootPane)
    const sess = allSessions.find(s => s.id === sessId)
    const key = `${connId}_${sessId}`

    if (unlistenersRef.current[key]) {
      unlistenersRef.current[key]()
      delete unlistenersRef.current[key]
    }

    if (sess?.shellId) {
      await invoke('close_shell', { id: sess.shellId }).catch(() => {})
    }
    
    if (terminalInstances.current[key]) {
      terminalInstances.current[key].dispose()
      delete terminalInstances.current[key]
    }
    delete fitAddons.current[key]
    delete searchAddons.current[key]
    delete resizeObserversRef.current[key]
    initializedRef.current.delete(key)
    
    if (allSessions.length === 1) {
      await invoke('disconnect_ssh', { id: connId }).catch(() => {})
      closeConnection(connId)
    } else if (paneId) {
      const pane = findPaneBySessionId(conn.rootPane, sessId)
      if (pane && pane.sessions.length === 1 && hasSplitChildren(conn.rootPane)) {
        closePane(connId, paneId)
      } else {
        closeSessionInPane(connId, paneId, sessId)
      }
    } else {
      closeSession(connId, sessId)
    }
  }, [connectedConnections, closeSession, closeConnection, closeSessionInPane, closePane])

  const handleCloseConnection = useCallback(async (connId: string) => {
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn) return

    const allSessions = getAllSessions(conn.rootPane)
    for (const s of allSessions) {
      const key = `${connId}_${s.id}`
      
      if (unlistenersRef.current[key]) {
        unlistenersRef.current[key]()
        delete unlistenersRef.current[key]
      }
      
      if (s.shellId) await invoke('close_shell', { id: s.shellId }).catch(() => {})
      if (terminalInstances.current[key]) {
        terminalInstances.current[key].dispose()
        delete terminalInstances.current[key]
      }
      delete fitAddons.current[key]
      delete searchAddons.current[key]
      delete resizeObserversRef.current[key]
      initializedRef.current.delete(key)
    }

    await invoke('disconnect_ssh', { id: connId }).catch(() => {})
    closeConnection(connId)
  }, [connectedConnections, closeConnection])

  // 窗口调整
  useEffect(() => {
    const resize = () => Object.values(fitAddons.current).forEach(a => { try { a?.fit() } catch {} })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // 清理所有事件监听
  useEffect(() => {
    return () => {
      Object.values(unlistenersRef.current).forEach(unlisten => unlisten())
    }
  }, [])

  // 终端设置变更时应用到所有已打开终端
  useEffect(() => {
    Object.values(terminalInstances.current).forEach(term => {
      if (term) {
        term.options.fontFamily = `"${terminalSettings.fontFamily}", Menlo, Monaco, monospace`
        term.options.fontSize = terminalSettings.fontSize
        term.options.cursorStyle = terminalSettings.cursorStyle
        term.options.cursorBlink = terminalSettings.cursorBlink
      }
    })
    Object.values(fitAddons.current).forEach(addon => {
      try { addon?.fit() } catch {}
    })
  }, [terminalSettings])
  
  // 复制选中内容
  const handleCopy = useCallback(async () => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    if (term) {
      const selection = term.getSelection()
      if (selection) {
        await writeText(selection)
        message.success('已复制')
      } else {
        message.info('请先选择要复制的内容')
      }
    }
    hideContextMenu()
  }, [contextMenu.sessionKey, hideContextMenu, message])
  
  const handlePaste = useCallback(async () => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    
    try {
      const text = await readText()
      if (text) {
        const [connId, sessId] = contextMenu.sessionKey.split('_')
        const conn = connectedConnections.find(c => c.connectionId === connId)
        if (conn) {
          const allSessions = getAllSessions(conn.rootPane)
          const sess = allSessions.find(s => s.id === sessId)
          if (sess?.shellId) {
            await invoke('write_shell', { id: sess.shellId, data: text })
          }
        }
      }
      if (term) {
        term.clearSelection()
        term.focus()
      }
    } catch (err) {
      console.error('粘贴失败:', err)
    }
    hideContextMenu()
  }, [contextMenu.sessionKey, connectedConnections])
  
  // 全选
  const handleSelectAll = useCallback(() => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    if (term) {
      term.selectAll()
    }
    hideContextMenu()
  }, [contextMenu.sessionKey])

  const handleFindFromContextMenu = useCallback(() => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    if (term) {
      const selection = term.getSelection()
      if (selection) {
        setSearchText(selection)
      }
    }
    setSearchVisible(true)
    hideContextMenu()
  }, [contextMenu.sessionKey])

  const handleSplitHorizontalFromContextMenu = useCallback(async () => {
    const [connId, sessId] = contextMenu.sessionKey.split('_')
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn) {
      hideContextMenu()
      return
    }
    const pane = findPaneBySessionId(conn.rootPane, sessId)
    if (!pane) {
      hideContextMenu()
      return
    }
    try {
      const newShellId = await invoke<string>('get_shell', { id: connId })
      const newPaneId = Date.now().toString()
      splitPane(connId, pane.id, 'horizontal', newPaneId, newShellId)
    } catch (err) {
      message.error(`分屏失败: ${err}`)
    }
    hideContextMenu()
  }, [contextMenu.sessionKey, connectedConnections, splitPane, message])

  const handleSplitVerticalFromContextMenu = useCallback(async () => {
    const [connId, sessId] = contextMenu.sessionKey.split('_')
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn) {
      hideContextMenu()
      return
    }
    const pane = findPaneBySessionId(conn.rootPane, sessId)
    if (!pane) {
      hideContextMenu()
      return
    }
    try {
      const newShellId = await invoke<string>('get_shell', { id: connId })
      const newPaneId = Date.now().toString()
      splitPane(connId, pane.id, 'vertical', newPaneId, newShellId)
    } catch (err) {
      message.error(`分屏失败: ${err}`)
    }
    hideContextMenu()
  }, [contextMenu.sessionKey, connectedConnections, splitPane, message])

  const handleCloseSplitFromContextMenu = useCallback(async () => {
    const [connId, sessId] = contextMenu.sessionKey.split('_')
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn || !hasSplitChildren(conn.rootPane)) {
      hideContextMenu()
      return
    }
    const pane = findPaneBySessionId(conn.rootPane, sessId)
    if (!pane) {
      hideContextMenu()
      return
    }
    for (const s of pane.sessions) {
      const key = `${connId}_${s.id}`
      if (unlistenersRef.current[key]) {
        unlistenersRef.current[key]()
        delete unlistenersRef.current[key]
      }
      if (s.shellId) await invoke('close_shell', { id: s.shellId }).catch(() => {})
      if (terminalInstances.current[key]) {
        terminalInstances.current[key].dispose()
        delete terminalInstances.current[key]
      }
      delete fitAddons.current[key]
      delete searchAddons.current[key]
      delete resizeObserversRef.current[key]
      initializedRef.current.delete(key)
    }
    closePane(connId, pane.id)
    hideContextMenu()
  }, [contextMenu.sessionKey, connectedConnections, closePane, message])

  const isContextMenuOnSplitPanel = useCallback(() => {
    const [connId, sessId] = contextMenu.sessionKey.split('_')
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn || !hasSplitChildren(conn.rootPane)) return false
    const pane = findPaneBySessionId(conn.rootPane, sessId)
    return pane !== null && hasSplitChildren(conn.rootPane)
  }, [contextMenu.sessionKey, connectedConnections])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        const activeSess = activeConn ? getActiveSessionInPane(activeConn.rootPane) : null
        if (activeSess) {
          const key = `${activeSess.connectionId}_${activeSess.id}`
          const term = terminalInstances.current[key]
          if (term && term.hasSelection()) {
            setSearchText(term.getSelection())
          }
        }
        setSearchVisible(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeConnectionId, connectedConnections])

  // 右侧面板宽度变化时调整终端尺寸
  useEffect(() => {
    if (prevPanelWidthRef.current !== rightPanelWidth) {
      prevPanelWidthRef.current = rightPanelWidth
      const timer = setTimeout(() => {
        Object.values(fitAddons.current).forEach(addon => {
          try { addon?.fit() } catch {}
        })
      }, 350)
      return () => clearTimeout(timer)
    }
  }, [rightPanelWidth, prevPanelWidthRef])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const width = rect.width
    const height = rect.height

    const edgeSize = 80

    if (x < edgeSize) {
      setDropIndicator('left')
    } else if (x > width - edgeSize) {
      setDropIndicator('right')
    } else if (y < edgeSize) {
      setDropIndicator('top')
    } else if (y > height - edgeSize) {
      setDropIndicator('bottom')
    } else {
      setDropIndicator(null)
    }
  }, [])

  const handleDragLeave = useCallback(() => {
    setDropIndicator(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetConnectionId: string, targetPaneId: string) => {
    e.preventDefault()
    setDropIndicator(null)

    const sourceConnectionId = e.dataTransfer.getData('connectionId')
    const sourceSessionId = e.dataTransfer.getData('sessionId')

    if (!sourceConnectionId || !sourceSessionId) return
    if (sourceConnectionId !== targetConnectionId) {
      message.warning('暂不支持跨连接分屏')
      return
    }

    const direction = dropIndicator === 'left' || dropIndicator === 'right' ? 'horizontal' : 'vertical'

    try {
      const newShellId = await invoke<string>('get_shell', { id: targetConnectionId })
      const newPaneId = Date.now().toString()
      splitPane(targetConnectionId, targetPaneId, direction, newPaneId, newShellId)
    } catch (err) {
      message.error(`分屏失败: ${err}`)
    }

    setDraggedSession(null)
  }, [dropIndicator, splitPane, message])

  if (connectedConnections.length === 0 && disconnectedConnections.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--color-bg-container)' }}>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>没有活动的会话</p>
        <p style={{ color: 'var(--color-text-quaternary)', fontSize: 14 }}>请先在连接管理中连接服务器</p>
      </div>
    )
  }

  function getPaneStructureKey(pane: SplitPane): string {
    if (pane.children && pane.children.length > 0) {
      return `${pane.id}-[${pane.children.map(getPaneStructureKey).join(',')}]`
    }
    return pane.id
  }

  const renderSplitPane = (
    pane: SplitPane,
    connectionId: string
  ): React.ReactNode => {
    if (pane.children && pane.children.length > 0) {
      const layout = pane.sizes || pane.children.map(() => 100 / pane.children!.length)
      return (
        <Group
          key={getPaneStructureKey(pane)}
          orientation={pane.splitDirection === 'vertical' ? 'vertical' : 'horizontal'}
          style={{ height: '100%', width: '100%' }}
        >
          {pane.children.map((child, index) => (
            <Panel key={child.id} defaultSize={layout[index]} minSize={20}>
              {renderSplitPane(child, connectionId)}
            </Panel>
          ))}
        </Group>
      )
    }

    const activeSess = pane.activeSessionId 
      ? pane.sessions.find(s => s.id === pane.activeSessionId) 
      : pane.sessions[0]

    if (!activeSess) return null

    const handleAddSessionToPane = async () => {
      try {
        const shellId = await invoke<string>('get_shell', { id: connectionId })
        addSessionToPane(connectionId, pane.id, shellId)
        message.success('会话已创建')
      } catch (err) {
        message.error(`创建失败: ${err}`)
      }
    }

    const sessionTabItems = pane.sessions.map(s => ({
      key: s.id,
      label: (
        <DraggableSessionTab
          sessionId={s.id}
          connectionId={connectionId}
          title={s.title}
          onClose={() => handleCloseSession(connectionId, s.id, pane.id)}
          onDragStart={(sid, cid) => setDraggedSession({ sessionId: sid, connectionId: cid })}
        />
      ),
      children: (
        <div
          ref={el => { terminalRefs.current[`${connectionId}_${s.id}`] = el }}
          style={{ height: '100%', background: 'var(--color-bg-base)', overflow: 'hidden', paddingLeft: 8, boxSizing: 'border-box' }}
          onContextMenu={(e) => handleContextMenu(e, `${connectionId}_${s.id}`)}
        />
      ),
    }))

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-container)' }}>
        <Tabs
          activeKey={activeSess.id}
          onChange={sid => setActiveSessionInPane(connectionId, pane.id, sid)}
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
          tabBarStyle={{ margin: 0, padding: '0 4px', background: 'var(--color-bg-elevated)', minHeight: 28 }}
          onTabClick={(key) => { if (key === '__add__') handleAddSessionToPane() }}
          destroyInactiveTabPane={false}
          size="small"
        />
      </div>
    )
  }

  const disconnectedItems = disconnectedConnections.map(dc => ({
    key: dc.connectionId,
    label: (
      <span style={{ color: 'var(--color-error)' }}>
        <DisconnectOutlined style={{ marginRight: 4 }} />
        {dc.connection.name}
        <CloseOutlined style={{ marginLeft: 6, fontSize: 10 }} onClick={e => { e.stopPropagation(); handleRemoveDisconnected(dc.connectionId) }} />
      </span>
    ),
    children: (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--color-bg-container)' }}>
        <DisconnectOutlined style={{ fontSize: 48, color: 'var(--color-error)' }} />
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>连接已断开</p>
        <p style={{ color: 'var(--color-text-quaternary)', fontSize: 14 }}>
          {dc.reason === 'write_failed' && '写入失败，可能是网络中断'}
          {dc.reason === 'channel_closed' && 'SSH Channel 被关闭'}
          {dc.reason === 'server_close' && '服务器主动关闭连接'}
          {dc.reason === 'unknown' && '原因未知'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="primary" icon={<ReloadOutlined />} onClick={() => handleReconnect(dc)}>
            重新连接
          </Button>
          <Button onClick={() => handleRemoveDisconnected(dc.connectionId)}>
            关闭
          </Button>
        </div>
      </div>
    ),
  }))

  const connectionItems = connectedConnections.map(conn => {
    return {
      key: conn.connectionId,
      label: (
        <SortableTab
          id={conn.connectionId}
          label={
            <span style={{ color: conn.connection.group === '生产环境' ? '#E65100' : 'var(--color-text)', fontWeight: 500 }}>
              {conn.connection.username}@{conn.connection.host}
              <CloseOutlined style={{ marginLeft: 8, fontSize: 10 }} onClick={e => { e.stopPropagation(); handleCloseConnection(conn.connectionId) }} />
            </span>
          }
        />
      ),
      children: (
        <div
          style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, conn.connectionId, conn.rootPane.id)}
        >
          {dropIndicator && draggedSession && draggedSession.connectionId === conn.connectionId && (
            <div
              style={{
                position: 'absolute',
                zIndex: 100,
                background: 'rgba(0, 185, 107, 0.3)',
                border: '2px dashed var(--color-primary)',
                ...(dropIndicator === 'left' && { left: 0, top: 0, width: '50%', height: '100%' }),
                ...(dropIndicator === 'right' && { right: 0, top: 0, width: '50%', height: '100%' }),
                ...(dropIndicator === 'top' && { left: 0, top: 0, width: '100%', height: '50%' }),
                ...(dropIndicator === 'bottom' && { left: 0, bottom: 0, width: '100%', height: '50%' }),
                pointerEvents: 'none',
              }}
            />
          )}
          {renderSplitPane(conn.rootPane, conn.connectionId)}
        </div>
      ),
    }
  })

  const handleConnectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = connectedConnections.findIndex(c => c.connectionId === active.id)
      const newIndex = connectedConnections.findIndex(c => c.connectionId === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderConnections(oldIndex, newIndex)
      }
    }
  }

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', display: 'flex' }}>
      <div style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleConnectionDragEnd}>
          <SortableContext items={connectedConnections.map(c => c.connectionId)} strategy={horizontalListSortingStrategy}>
            <Tabs
              activeKey={activeConnectionId || undefined}
              onChange={setActiveConnection}
              items={[...connectionItems, ...disconnectedItems]}
              style={{ height: '100%' }}
              tabBarStyle={{ margin: 0, padding: '0 12px', background: 'var(--color-bg-elevated)' }}
              destroyInactiveTabPane={false}
            />
          </SortableContext>
        </DndContext>
      </div>

      <div style={{
        width: (monitorVisible || (activeConnectionId && fileManagerVisible[activeConnectionId]) || apiLogVisible) ? 360 : 0,
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.2s ease',
      }}>
        {monitorVisible && (
          <MonitorPanel visible={monitorVisible} connectionId={activeConnectionId || ''} onClose={() => setMonitorVisible(false)} />
        )}
        {activeConnectionId && fileManagerVisible[activeConnectionId] && (
          <FileManagerPanel
            connectionId={activeConnectionId}
            visible={true}
            onClose={() => setFileManagerVisible(activeConnectionId, false)}
          />
        )}
        {apiLogVisible && (
          <McpLogPanel visible={apiLogVisible} onClose={() => setApiLogVisible(false)} />
        )}
      </div>

      <RightSidebar
        connectionId={activeConnectionId}
        monitorVisible={monitorVisible}
        fileManagerVisible={activeConnectionId ? !!fileManagerVisible[activeConnectionId] : false}
        apiLogVisible={apiLogVisible}
        mcpEnabled={mcpEnabled}
        onMonitorToggle={() => {
          if (monitorVisible) {
            setMonitorVisible(false)
          } else {
            setMonitorVisible(true)
            if (activeConnectionId && fileManagerVisible[activeConnectionId]) {
              setFileManagerVisible(activeConnectionId, false)
            }
            setApiLogVisible(false)
          }
        }}
        onFileManagerToggle={() => {
          if (!activeConnectionId) return
          const isVisible = fileManagerVisible[activeConnectionId]
          if (isVisible) {
            setFileManagerVisible(activeConnectionId, false)
          } else {
            setFileManagerVisible(activeConnectionId, true)
            setMonitorVisible(false)
            setApiLogVisible(false)
          }
        }}
        onApiLogToggle={() => {
          if (apiLogVisible) {
            setApiLogVisible(false)
          } else {
            setApiLogVisible(true)
            setMonitorVisible(false)
            if (activeConnectionId && fileManagerVisible[activeConnectionId]) {
              setFileManagerVisible(activeConnectionId, false)
            }
          }
        }}
      />

      {activeConnection && activeSession && (
        <TerminalToolbar
          sessionKey={`${activeConnection.connectionId}_${activeSession.id}`}
          connectionName={activeConnection.connection.name}
          terminalInstances={terminalInstances}
          toolbarState={toolbarState}
          autoHideToolbar={autoHideToolbar}
          mouseOverBall={mouseOverBall}
          searchVisible={searchVisible}
          isFullscreen={isFullscreen}
          rightPanelWidth={rightPanelWidth}
          shortcutSettings={shortcutSettings}
          hasSplitPanel={hasSplitChildren(activeConnection.rootPane)}
          onShowSearch={() => setSearchVisible(!searchVisible)}
          onToggleFullscreen={handleToggleFullscreen}
          onSplitHorizontal={async () => {
            try {
              const pane = findPaneBySessionId(activeConnection.rootPane, activeSession.id)
              if (!pane) return
              const newShellId = await invoke<string>('get_shell', { id: activeConnection.connectionId })
              const newPaneId = Date.now().toString()
              splitPane(activeConnection.connectionId, pane.id, 'horizontal', newPaneId, newShellId)
            } catch (err) {
              message.error(`分屏失败: ${err}`)
            }
          }}
          onSplitVertical={async () => {
            try {
              const pane = findPaneBySessionId(activeConnection.rootPane, activeSession.id)
              if (!pane) return
              const newShellId = await invoke<string>('get_shell', { id: activeConnection.connectionId })
              const newPaneId = Date.now().toString()
              splitPane(activeConnection.connectionId, pane.id, 'vertical', newPaneId, newShellId)
            } catch (err) {
              message.error(`分屏失败: ${err}`)
            }
          }}
          onCloseSplit={async () => {
            if (!hasSplitChildren(activeConnection.rootPane)) return
            const pane = findPaneBySessionId(activeConnection.rootPane, activeSession.id)
            if (!pane) return
            for (const s of pane.sessions) {
              const key = `${activeConnection.connectionId}_${s.id}`
              if (unlistenersRef.current[key]) {
                unlistenersRef.current[key]()
                delete unlistenersRef.current[key]
              }
              if (s.shellId) await invoke('close_shell', { id: s.shellId }).catch(() => {})
              if (terminalInstances.current[key]) {
                terminalInstances.current[key].dispose()
                delete terminalInstances.current[key]
              }
              delete fitAddons.current[key]
              delete searchAddons.current[key]
              delete resizeObserversRef.current[key]
              initializedRef.current.delete(key)
            }
            closePane(activeConnection.connectionId, pane.id)
          }}
          onToggleAutoHide={() => setAutoHideToolbar(!autoHideToolbar)}
          onMouseLeave={() => {
            if (autoHideToolbar && !searchVisible) {
              setToolbarState('ball')
              setMouseOverBall(false)
            }
          }}
          onMouseEnterBall={() => {
            setMouseOverBall(true)
            setToolbarState('full')
          }}
          setSearchText={setSearchText}
          handleSearch={handleSearch}
          closeSearch={() => {
            setSearchVisible(false)
            setSearchText('')
          }}
          searchText={searchText}
        />
      )}

      {contextMenu.visible && (
        <div
          id="terminal-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: 'var(--color-bg-elevated)',
            borderRadius: 6,
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            minWidth: 160,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handleCopy}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <CopyOutlined /> 复制
          </div>
          <div
            style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handlePaste}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <SnippetsOutlined /> 粘贴
          </div>
          <div
            style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handleSelectAll}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <CheckCircleOutlined /> 全选
          </div>
          <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
          <div
            style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handleFindFromContextMenu}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <SearchOutlined /> 查找 <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)', fontSize: 11 }}>Ctrl+F</span>
          </div>
          <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
          {isContextMenuOnSplitPanel() ? (
            <div
              style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={handleCloseSplitFromContextMenu}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <CloseOutlined /> 关闭分屏
            </div>
          ) : (
            <>
              <div
                style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={handleSplitHorizontalFromContextMenu}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <BorderHorizontalOutlined /> 水平分屏
              </div>
              <div
                style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={handleSplitVerticalFromContextMenu}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <BorderVerticleOutlined /> 垂直分屏
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default Terminal
