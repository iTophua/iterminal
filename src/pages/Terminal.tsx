import { useEffect, useRef, useCallback, useState } from 'react'
import { Tabs, App, Button, Tooltip } from 'antd'
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
import { Panel, Group, Separator } from 'react-resizable-panels'
import 'xterm/css/xterm.css'
import { useTerminalStore, DisconnectedConnection } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { resolveTerminalTheme } from '../styles/themes/terminal-themes'
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
  const splitSession = useTerminalStore(state => state.splitSession)
  const closeSplitPanel = useTerminalStore(state => state.closeSplitPanel)
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
  const activeSession = activeConnection?.sessions.find(s => s.id === activeConnection?.activeSessionId)

  // 初始化终端
  useEffect(() => {
    if (!activeSession?.shellId) return

    const key = `${activeSession.connectionId}_${activeSession.id}`
    const shellId = activeSession.shellId

    // 已初始化过
    if (initializedRef.current.has(key)) {
      const term = terminalInstances.current[key]
      const addon = fitAddons.current[key]
      const container = terminalRefs.current[key]

      // 如果终端元素不在当前容器中，移动它
      if (term && container && term.element && !container.contains(term.element)) {
        container.innerHTML = ''
        container.appendChild(term.element)
        requestAnimationFrame(() => {
          try { term.focus() } catch {}
        })
      }

      if (addon) requestAnimationFrame(() => { try { addon.fit() } catch {} })
      if (term) requestAnimationFrame(() => { try { term.focus() } catch {} })
      return
    }

    const container = terminalRefs.current[key]
    if (!container) return

    let cancelled = false
    let initialized = false

    // 使用 async 函数确保正确的初始化顺序
    const init = async () => {
      // 1. 等待容器有有效尺寸
      const waitForContainerSize = (): Promise<void> => {
        return new Promise((resolve) => {
          const checkSize = () => {
            if (cancelled) {
              resolve()
              return
            }
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

      // 检查是否在等待过程中被取消
      if (cancelled) return

      // 2. 创建终端
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

      // 禁用 xterm 内部 textarea 的 paste 事件，防止双重粘贴
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

      // 输入处理 - 添加错误处理
      terminal.onData(data => {
        invoke('write_shell', { id: shellId, data }).catch(err => {
          console.error('写入终端失败:', err)
        })
      })

      // 终端尺寸变化时通知 SSH 服务器 - 添加错误处理
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

      // 暂存到 ref，供事件回调使用
      terminalInstances.current[key] = terminal
      fitAddons.current[key] = fitAddon

      // 加载搜索插件
      const searchAddon = new SearchAddon()
      terminal.loadAddon(searchAddon)
      searchAddons.current[key] = searchAddon

      // 3. 注册事件监听
      const eventName = `shell-output-${shellId}`

      const unlisten = await listen<string>(eventName, (event) => {
        const term = terminalInstances.current[key]
        if (term && event.payload) {
          // 处理 EOF 信号（后端发送 { eof: true }）
          if (typeof event.payload === 'object' && (event.payload as any).eof) {
            return
          }
          term.write(event.payload)
        }
      })

      if (cancelled) {
        unlisten()
        return
      }

      unlistenersRef.current[key] = unlisten

      // 4. 设置 ResizeObserver 监听容器尺寸变化
      // 使用 requestAnimationFrame 实现更流畅的调整
      let rafId: number | null = null
      const resizeObserver = new ResizeObserver(() => {
        // 取消之前的 RAF
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
        }
        // 使用 RAF 确保在下一帧执行
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

      // 5. 初始调整终端大小
      requestAnimationFrame(() => {
        try { fitAddon.fit() } catch {}
        try { terminal.focus() } catch {}
      })

      // 标记为已初始化
      initialized = true
      initializedRef.current.add(key)

      // 6. 通知后端开始发送数据
      try {
        await invoke('start_shell_reader', { id: shellId })
      } catch (err) {
        console.error('启动终端读取器失败:', err)
        message.error('启动终端失败，请重试')
      }
    }

    init().catch(err => {
      console.error('终端初始化失败:', err)
      message.error('终端初始化失败')
    })

    return () => {
      cancelled = true
      // 如果初始化未完成，清理已创建的资源
      if (!initialized) {
        initializedRef.current.delete(key)
        if (terminalInstances.current[key]) {
          terminalInstances.current[key].dispose()
          delete terminalInstances.current[key]
        }
        delete fitAddons.current[key]
        delete searchAddons.current[key]
      }
      if (resizeObserversRef.current[key]) {
        resizeObserversRef.current[key].disconnect()
        delete resizeObserversRef.current[key]
      }
    }
  }, [activeSession?.id, activeSession?.connectionId, activeSession?.shellId, activeSession?.splitPanels, terminalSettings, shortcutSettings, appTheme, terminalThemeKey, message])

  useEffect(() => {
    if (!activeSession?.splitPanels) return

    activeSession.splitPanels.forEach(panel => {
      const key = `${activeSession.connectionId}_${panel.id}`
      
      if (initializedRef.current.has(key)) {
        const addon = fitAddons.current[key]
        if (addon) requestAnimationFrame(() => { try { addon.fit() } catch {} })
        return
      }

      const container = terminalRefs.current[key]
      if (!container) return

      const initPanel = async () => {
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

        terminal.onData(data => {
          invoke('write_shell', { id: panel.shellId, data }).catch(err => {
            console.error('写入终端失败:', err)
          })
        })

        terminal.onResize(({ cols, rows }) => {
          invoke('resize_shell', { id: panel.shellId, cols, rows }).catch(err => {
            console.error('调整终端大小失败:', err)
          })
        })

        terminalInstances.current[key] = terminal
        fitAddons.current[key] = fitAddon

        const searchAddon = new SearchAddon()
        terminal.loadAddon(searchAddon)
        searchAddons.current[key] = searchAddon

        const eventName = `shell-output-${panel.shellId}`
        const unlisten = await listen<string>(eventName, (event) => {
          const term = terminalInstances.current[key]
          if (term && event.payload) {
            if (typeof event.payload === 'object' && (event.payload as any).eof) return
            term.write(event.payload)
          }
        })
        unlistenersRef.current[key] = unlisten

        const resizeObserver = new ResizeObserver(() => {
          requestAnimationFrame(() => {
            try { fitAddon.fit() } catch {}
          })
        })
        resizeObserver.observe(container)
        resizeObserversRef.current[key] = resizeObserver

        requestAnimationFrame(() => {
          try { fitAddon.fit() } catch {}
          try { terminal.focus() } catch {}
        })

        initializedRef.current.add(key)
      }

      initPanel().catch(err => {
        console.error('分屏终端初始化失败:', err)
      })
    })
  }, [activeSession?.splitPanels, terminalSettings, appTheme, terminalThemeKey])

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

  // 关闭会话
  const handleCloseSession = useCallback(async (connId: string, sessId: string) => {
    const conn = connectedConnections.find(c => c.connectionId === connId)
    const sess = conn?.sessions.find(s => s.id === sessId)
    const key = `${connId}_${sessId}`

    // 清理事件监听
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
    if (conn && conn.sessions.length === 1) {
      await invoke('disconnect_ssh', { id: connId }).catch(() => {})
      closeConnection(connId)
    } else {
      closeSession(connId, sessId)
    }
  }, [connectedConnections, closeSession, closeConnection])

  // 关闭连接
  const handleCloseConnection = useCallback(async (connId: string) => {
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn) return

    for (const s of conn.sessions) {
      const key = `${connId}_${s.id}`
      
      // 清理事件监听
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
  
  // 粘贴
  const handlePaste = useCallback(async () => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    
    try {
      const text = await readText()
      if (text) {
        const [connId, sessId] = contextMenu.sessionKey.split('_')
        const conn = connectedConnections.find(c => c.connectionId === connId)
        const sess = conn?.sessions.find(s => s.id === sessId)
        if (sess?.shellId) {
          await invoke('write_shell', { id: sess.shellId, data: text })
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        const activeSess = activeConn?.sessions.find(s => s.id === activeConn?.activeSessionId)
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

  if (connectedConnections.length === 0 && disconnectedConnections.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--color-bg-container)' }}>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>没有活动的会话</p>
        <p style={{ color: 'var(--color-text-quaternary)', fontSize: 14 }}>请先在连接管理中连接服务器</p>
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
    const sessionItems = conn.sessions.map((s, idx) => ({
      key: s.id,
      label: (
        <span style={{ fontSize: 12 }}>
          会话{idx + 1}
          <CloseOutlined style={{ marginLeft: 6, fontSize: 10 }} onClick={e => { e.stopPropagation(); handleCloseSession(conn.connectionId, s.id) }} />
        </span>
      ),
      children: (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {s.splitPanels && s.splitPanels.length > 0 ? (
            <Group orientation={s.splitDirection === 'vertical' ? 'vertical' : 'horizontal'} style={{ flex: 1 }}>
              <Panel defaultSize={50} minSize={20}>
                <div style={{ height: '100%', width: '100%', background: 'var(--color-bg-base)', overflow: 'hidden', paddingLeft: 8, boxSizing: 'border-box', position: 'relative' }}>
                  <div
                    ref={el => { terminalRefs.current[`${conn.connectionId}_${s.id}`] = el }}
                    style={{ height: '100%', width: '100%', overflow: 'hidden' }}
                    onContextMenu={(e) => handleContextMenu(e, `${conn.connectionId}_${s.id}`)}
                  />
                  <Tooltip title="关闭分屏">
                    <span
                      style={{ position: 'absolute', top: 4, right: 4, zIndex: 1000, color: 'var(--color-text-tertiary)', cursor: 'pointer', background: 'var(--color-bg-elevated)', padding: '2px 6px', borderRadius: 4, boxShadow: 'var(--shadow-sm)' }}
                      onClick={async () => {
                        for (const p of s.splitPanels || []) {
                          await invoke('close_shell', { id: p.shellId }).catch(() => {})
                          const pKey = `${conn.connectionId}_${p.id}`
                          if (terminalInstances.current[pKey]) {
                            terminalInstances.current[pKey].dispose()
                            delete terminalInstances.current[pKey]
                          }
                          delete fitAddons.current[pKey]
                          delete searchAddons.current[pKey]
                          initializedRef.current.delete(pKey)
                        }
                        closeSplitPanel(conn.connectionId, s.id, s.splitPanels![0].id)
                      }}
                    >
                      <CloseOutlined style={{ fontSize: 10 }} />
                    </span>
                  </Tooltip>
                </div>
              </Panel>
              <Separator style={{ width: 4, background: 'var(--color-border)', cursor: 'col-resize' }} />
              {s.splitPanels.map((panel) => (
                <Panel key={panel.id} defaultSize={50 / (s.splitPanels?.length || 1)} minSize={20}>
                  <div style={{ height: '100%', width: '100%', background: 'var(--color-bg-base)', overflow: 'hidden', paddingLeft: 8, boxSizing: 'border-box', position: 'relative' }}>
                    <div
                      ref={el => { terminalRefs.current[`${conn.connectionId}_${panel.id}`] = el }}
                      style={{ height: '100%', width: '100%', overflow: 'hidden' }}
                      onContextMenu={(e) => handleContextMenu(e, `${conn.connectionId}_${panel.id}`)}
                    />
                    <Tooltip title="关闭此分屏">
                      <span
                        style={{ position: 'absolute', top: 4, right: 4, zIndex: 1000, color: 'var(--color-text-tertiary)', cursor: 'pointer', background: 'var(--color-bg-elevated)', padding: '2px 6px', borderRadius: 4, boxShadow: 'var(--shadow-sm)' }}
                        onClick={async () => {
                          await invoke('close_shell', { id: panel.shellId }).catch(() => {})
                          const key = `${conn.connectionId}_${panel.id}`
                          if (terminalInstances.current[key]) {
                            terminalInstances.current[key].dispose()
                            delete terminalInstances.current[key]
                          }
                          delete fitAddons.current[key]
                          delete searchAddons.current[key]
                          initializedRef.current.delete(key)
                          closeSplitPanel(conn.connectionId, s.id, panel.id)
                        }}
                      >
                        <CloseOutlined style={{ fontSize: 10 }} />
                      </span>
                    </Tooltip>
                  </div>
                </Panel>
              ))}
            </Group>
          ) : (
            <div
              ref={el => { terminalRefs.current[`${conn.connectionId}_${s.id}`] = el }}
              style={{ flex: 1, width: '100%', background: 'var(--color-bg-base)', overflow: 'hidden', paddingLeft: 8, boxSizing: 'border-box' }}
              onContextMenu={(e) => handleContextMenu(e, `${conn.connectionId}_${s.id}`)}
            />
          )}
        </div>
      ),
    }))

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
        <Tabs
          activeKey={conn.activeSessionId || undefined}
          onChange={sid => { if (sid !== '__add__') setActiveSession(conn.connectionId, sid) }}
          items={[...sessionItems, { key: '__add__', label: <span style={{ color: 'var(--color-primary)', fontSize: 12 }}><PlusOutlined /> 新建</span>, children: <div /> }]}
          type="card"
          style={{ height: '100%' }}
          tabBarStyle={{ margin: 0, padding: '0 8px', background: 'var(--color-bg-container)', minHeight: 28 }}
          onTabClick={(key) => { if (key === '__add__') handleAddSession(conn.connectionId) }}
          destroyInactiveTabPane={false}
          size="small"
        />
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
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        marginRight: rightPanelWidth,
        transition: 'margin-right 0.3s ease',
        width: `calc(100% - ${rightPanelWidth}px)`
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
      <MonitorPanel visible={monitorVisible} connectionId={activeConnectionId || ''} onClose={() => setMonitorVisible(false)} />
      {activeConnectionId && (
        <FileManagerPanel
          connectionId={activeConnectionId}
          visible={!!fileManagerVisible[activeConnectionId]}
          onClose={() => setFileManagerVisible(activeConnectionId, false)}
        />
      )}
      <McpLogPanel visible={apiLogVisible} onClose={() => setApiLogVisible(false)} />

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
          mcpEnabled={mcpEnabled}
          rightPanelWidth={rightPanelWidth}
          shortcutSettings={shortcutSettings}
          onShowSearch={() => setSearchVisible(!searchVisible)}
          onToggleFullscreen={handleToggleFullscreen}
          onSplit={async () => {
            try {
              const newShellId = await invoke<string>('get_shell', { id: activeConnection.connectionId })
              splitSession(activeConnection.connectionId, activeSession.id, 'horizontal', newShellId)
            } catch (err) {
              message.error(`分屏失败: ${err}`)
            }
          }}
          onOpenMonitor={() => {
            setMonitorVisible(true)
            if (activeConnectionId && fileManagerVisible[activeConnectionId]) {
              setFileManagerVisible(activeConnectionId, false)
            }
            setApiLogVisible(false)
          }}
          onOpenFileManager={() => {
            const isVisible = fileManagerVisible[activeConnection.connectionId]
            setFileManagerVisible(activeConnection.connectionId, !isVisible)
            if (!isVisible) {
              setMonitorVisible(false)
              setApiLogVisible(false)
            }
          }}
          onToggleApiLog={() => {
            const newVisible = !apiLogVisible
            setApiLogVisible(newVisible)
            if (newVisible) {
              setMonitorVisible(false)
              if (activeConnectionId && fileManagerVisible[activeConnectionId]) {
                setFileManagerVisible(activeConnectionId, false)
              }
            }
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
        </div>
      )}
    </div>
  )
}

export default Terminal
