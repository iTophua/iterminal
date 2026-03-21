import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Tabs, App, Button, Tooltip } from 'antd'
import { createPortal } from 'react-dom'
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
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Panel, Group, Separator } from 'react-resizable-panels'
import 'xterm/css/xterm.css'
import { useTerminalStore, DisconnectedConnection, SplitPane, Session } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { resolveTerminalTheme } from '../styles/themes/terminal-themes'
import { RightSidebar } from '../components/RightSidebar'
import MonitorPanel from '../components/MonitorPanel'
import FileManagerPanel from '../components/FileManagerPanel'
import McpLogPanel from '../components/McpLogPanel'
import { STORAGE_KEYS } from '../config/constants'
import { useFullscreen, useContextMenu, useRightPanels } from './terminal/hooks'
import { PaneToolbar } from './terminal/components'

interface SortableTabProps {
  id: string
  label: React.ReactNode
  connectionName?: string
}

function SortableTab({ id, label, connectionName }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0,
    lineHeight: 1,
  }

  return (
    <span ref={setNodeRef} style={style} {...attributes} {...listeners} data-connection-tab-id={id} data-connection-name={connectionName}>
      <HolderOutlined style={{ fontSize: 10, color: 'var(--color-text-quaternary)', marginRight: 2 }} />
      {label}
    </span>
  )
}

interface DraggableSessionTabProps {
  sessionId: string
  connectionId: string
  title: string
  onClose: () => void
  onDragStart: (sessionId: string, connectionId: string, title: string) => void
}

function DraggableSessionTab({ sessionId, connectionId, title, onClose, onDragStart }: DraggableSessionTabProps) {
  return (
    <span
      style={{ fontSize: 12, cursor: 'grab', display: 'inline-flex', alignItems: 'center', gap: 0, padding: '2px 0' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest('.session-tab-close')) return
        e.stopPropagation()
        e.preventDefault()
        onDragStart(sessionId, connectionId, title)
      }}
    >
      <HolderOutlined style={{ fontSize: 10, color: 'var(--color-text-quaternary)', marginRight: 2 }} />
      <span style={{ lineHeight: '16px' }}>{title}</span>
      <CloseOutlined
        className="session-tab-close"
        style={{ marginLeft: 4, fontSize: 9, cursor: 'pointer' }}
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
    const targetPaneId = pane.activePaneId
    if (targetPaneId) {
      const findPaneById = (p: SplitPane): SplitPane | null => {
        if (p.id === targetPaneId) return p
        if (p.children) {
          for (const child of p.children) {
            const found = findPaneById(child)
            if (found) return found
          }
        }
        return null
      }
      const targetPane = findPaneById(pane)
      if (targetPane) {
        if (targetPane.activeSessionId) {
          return targetPane.sessions.find(s => s.id === targetPane.activeSessionId) || null
        }
        return targetPane.sessions[0] || null
      }
    }
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

function hasSplitChildren(pane: SplitPane | null): boolean {
  return !!(pane?.children && pane.children.length > 0)
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
  const closeSession = useTerminalStore(state => state.closeSession)
  const closeConnection = useTerminalStore(state => state.closeConnection)
  const removeConnectionFromStore = useTerminalStore(state => state.removeConnectionFromStore)
  const markConnectionDisconnected = useTerminalStore(state => state.markConnectionDisconnected)
  const removeDisconnectedConnection = useTerminalStore(state => state.removeDisconnectedConnection)
  const addConnection = useTerminalStore(state => state.addConnection)
  const splitPane = useTerminalStore(state => state.splitPane)
  const splitPaneWithPosition = useTerminalStore(state => state.splitPaneWithPosition)
  const moveSessionToSplitPane = useTerminalStore(state => state.moveSessionToSplitPane)
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
  const shortcutSettingsRef = useRef(shortcutSettings)
  
  useEffect(() => {
    shortcutSettingsRef.current = shortcutSettings
  }, [shortcutSettings])
  
  const {
    isFullscreen,
    handleToggleFullscreen,
  } = useFullscreen(setSidebarCollapsed, fitAddons)

  const {
    contextMenu,
    handleContextMenu,
    hideContextMenu,
  } = useContextMenu()

  const [searchText, setSearchText] = useState('')
  const [searchMode, setSearchMode] = useState<'normal' | 'regex' | 'wholeWord'>('normal')
  const [activeSearchSessionKey, setActiveSearchSessionKey] = useState<string | null>(null)

  const {
    monitorVisible,
    setMonitorVisible,
    apiLogVisible,
    setApiLogVisible,
    rightPanelWidth,
  } = useRightPanels(activeConnectionId, fileManagerVisible, setFileManagerVisible)
  
  const [mcpEnabled, setMcpEnabled] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MCP_ENABLED)
    return saved ? saved === 'true' : false
  })

  const [draggedSession, setDraggedSession] = useState<{ sessionId: string; connectionId: string; title: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ paneId: string; connectionId: string; direction: 'left' | 'right' | 'top' | 'bottom' } | null>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  // 拖拽连接 tab 到新窗口功能（暂时禁用）
  // const [connectionTabDragToNewWindow, setConnectionTabDragToNewWindow] = useState(false)
  // const [isConnectionDragging, setIsConnectionDragging] = useState(false)
  // const connectionDragIdRef = useRef<string | null>(null)
  const paneRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const draggedSessionRef = useRef<{ sessionId: string; connectionId: string; title: string } | null>(null)
  const dropTargetRef = useRef<{ paneId: string; connectionId: string; direction: 'left' | 'right' | 'top' | 'bottom' } | null>(null)
  const dragStartRef = useRef<{ sessionId: string; connectionId: string; title: string } | null>(null)
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    draggedSessionRef.current = draggedSession
  }, [draggedSession])

  useEffect(() => {
    dropTargetRef.current = dropTarget
  }, [dropTarget])
  
  // 拖拽连接 tab 到新窗口功能（暂时禁用）
  // useEffect(() => {
  //   if (!isConnectionDragging) return
  //   
  //   const handleConnectionPointerMove = (e: PointerEvent) => {
  //     const clientX = e.clientX
  //     const clientY = e.clientY
  //     const windowWidth = window.innerWidth
  //     const windowHeight = window.innerHeight
  //     const edgeThreshold = 60
  //     
  //     const atEdge = clientX <= edgeThreshold || clientX >= windowWidth - edgeThreshold ||
  //                    clientY <= edgeThreshold || clientY >= windowHeight - edgeThreshold
  //     
  //     setConnectionTabDragToNewWindow(atEdge)
  //   }
  //   
  //   window.addEventListener('pointermove', handleConnectionPointerMove)
  //   
  //   return () => {
  //     window.removeEventListener('pointermove', handleConnectionPointerMove)
  //   }
  // }, [isConnectionDragging])

  useEffect(() => {
    apiLogVisibleRef.current = apiLogVisible
  }, [apiLogVisible])

useEffect(() => {
    
const handlePointerUp = () => {
      if (dragTimerRef.current) {
        clearTimeout(dragTimerRef.current)
        dragTimerRef.current = null
      }
      
      const currentDropTarget = dropTargetRef.current
      const currentDraggedSession = draggedSessionRef.current
      
      document.body.style.userSelect = ''
      draggedSessionRef.current = null
      dragStartRef.current = null
      setDraggedSession(null)
      setDropTarget(null)
      setDragPosition(null)
      
      if (currentDropTarget && currentDraggedSession) {
        const { connectionId: targetConnId, paneId: targetPaneId, direction } = currentDropTarget

        const splitDirection = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical'
        const newPosition = direction === 'left' || direction === 'top' ? 'first' : 'second'

        const conn = connectedConnections.find(c => c.connectionId === currentDraggedSession.connectionId)
        const sourcePane = conn ? findPaneBySessionId(conn.rootPane, currentDraggedSession.sessionId) : null
        
        if (sourcePane && sourcePane.sessions.length > 1) {
          moveSessionToSplitPane(
            currentDraggedSession.connectionId,
            sourcePane.id,
            currentDraggedSession.sessionId,
            targetPaneId,
            splitDirection,
            newPosition
          )
        } else {
          invoke<string>('get_shell', { id: targetConnId }).then(newShellId => {
            const newPaneId = Date.now().toString()
            splitPaneWithPosition(targetConnId, targetPaneId, splitDirection, newPaneId, newShellId, newPosition)
          }).catch(err => {
            message.error(`分屏失败: ${err}`)
          })
        }
      }
    }

    const handlePointerMove = (e: PointerEvent) => {
      const currentDraggedSession = draggedSessionRef.current
      if (!currentDraggedSession) return

      e.preventDefault()
      setDragPosition({ x: e.clientX + 10, y: e.clientY + 10 })

      const { clientX, clientY } = e

      let foundTarget: { paneId: string; connectionId: string; direction: 'left' | 'right' | 'top' | 'bottom' } | null = null

      paneRefs.current.forEach((el, paneKey) => {
        const [paneConnId, paneId] = paneKey.split('::')
        if (paneConnId !== currentDraggedSession.connectionId) return

        const rect = el.getBoundingClientRect()
        const inRect = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
        if (!inRect) return

        const x = clientX - rect.left
        const y = clientY - rect.top
        const width = rect.width
        const height = rect.height
        const edgeSize = Math.min(width, height) * 0.35

        let direction: 'left' | 'right' | 'top' | 'bottom' | null = null
        if (x < edgeSize) direction = 'left'
        else if (x > width - edgeSize) direction = 'right'
        else if (y < edgeSize) direction = 'top'
        else if (y > height - edgeSize) direction = 'bottom'

        if (direction) {
          foundTarget = { paneId, connectionId: paneConnId, direction }
        }
      })

      if (foundTarget) {
        setDropTarget(foundTarget)
      } else if (dropTargetRef.current) {
        setDropTarget(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      if (dragTimerRef.current) {
        clearTimeout(dragTimerRef.current)
        dragTimerRef.current = null
      }
    }
  }, [connectedConnections, splitPaneWithPosition, moveSessionToSplitPane, message])

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
  const visibleSessions = activeConnection ? getVisibleSessions(activeConnection.rootPane) : []

  // 切换连接时重置搜索状态
  useEffect(() => {
    setActiveSearchSessionKey(null)
    setSearchText('')
  }, [activeConnectionId])

  const paneStructureRef = useRef<string>('')
  useEffect(() => {
    if (!activeConnection) return
    
    const getStructureKey = (pane: SplitPane): string => {
      if (pane.children && pane.children.length > 0) {
        return `${pane.id}-[${pane.children.map(getStructureKey).join(',')}]`
      }
      return `${pane.id}-${pane.sessions.length}`
    }
    
    const structureKey = getStructureKey(activeConnection.rootPane)
    if (paneStructureRef.current && paneStructureRef.current !== structureKey) {
      setTimeout(() => {
        Object.values(fitAddons.current).forEach(addon => {
          try { addon?.fit() } catch {}
        })
      }, 100)
    }
    paneStructureRef.current = structureKey
  }, [activeConnection, activeConnection?.rootPane])

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
          macOptionIsMeta: true,
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
          if (!shortcut) return false
          
          const parts = shortcut.toUpperCase().split('+')
          const modifiers = ['CTRL', 'CMD', 'SHIFT', 'ALT', 'META']
          const hasModifiers = parts.some(p => modifiers.includes(p))
          
          const hasCtrl = parts.includes('CTRL')
          const hasCmd = parts.includes('CMD')
          const hasShift = parts.includes('SHIFT')
          const hasAlt = parts.includes('ALT')
          const hasMeta = parts.includes('META')
          const keyPart = parts.find(p => !modifiers.includes(p))
          
          const ctrlMatch = hasCtrl ? event.ctrlKey : (!hasModifiers ? !event.ctrlKey : true)
          const cmdMatch = hasCmd ? event.metaKey : (!hasModifiers ? !event.metaKey : true)
          const shiftMatch = hasShift ? event.shiftKey : (!hasModifiers ? !event.shiftKey : true)
          const altMatch = hasAlt ? event.altKey : (!hasModifiers ? !event.altKey : true)
          const metaMatch = hasMeta ? event.metaKey : (hasCmd ? true : (!hasModifiers ? !event.metaKey : true))
          
          let keyMatch = false
          if (keyPart) {
            const eventKey = event.key.toUpperCase()
            const eventCode = event.code.toUpperCase()
            
            keyMatch = eventKey === keyPart ||
              eventCode === 'KEY' + keyPart ||
              eventCode === keyPart ||
              (keyPart === 'ENTER' && (eventKey === 'ENTER' || eventCode === 'ENTER')) ||
              ((keyPart === 'ARROWRIGHT' || keyPart === 'RIGHT') && (eventKey === 'ARROWRIGHT' || eventCode === 'ARROWRIGHT')) ||
              ((keyPart === 'ARROWLEFT' || keyPart === 'LEFT') && (eventKey === 'ARROWLEFT' || eventCode === 'ARROWLEFT')) ||
              ((keyPart === 'ARROWUP' || keyPart === 'UP') && (eventKey === 'ARROWUP' || eventCode === 'ARROWUP')) ||
              ((keyPart === 'ARROWDOWN' || keyPart === 'DOWN') && (eventKey === 'ARROWDOWN' || eventCode === 'ARROWDOWN')) ||
              (keyPart === 'SPACE' && (eventKey === ' ' || eventCode === 'SPACE')) ||
              (keyPart === 'TAB' && (eventKey === 'TAB' || eventCode === 'TAB')) ||
              (keyPart === 'ESCAPE' && (eventKey === 'ESCAPE' || eventCode === 'ESCAPE')) ||
              (keyPart === 'BACKSPACE' && (eventKey === 'BACKSPACE' || eventCode === 'BACKSPACE')) ||
              (keyPart === 'DELETE' && (eventKey === 'DELETE' || eventCode === 'DELETE')) ||
              (keyPart === 'F1' && eventCode === 'F1') ||
              (keyPart === 'F2' && eventCode === 'F2') ||
              (keyPart === 'F3' && eventCode === 'F3') ||
              (keyPart === 'F4' && eventCode === 'F4') ||
              (keyPart === 'F5' && eventCode === 'F5') ||
              (keyPart === 'F6' && eventCode === 'F6') ||
              (keyPart === 'F7' && eventCode === 'F7') ||
              (keyPart === 'F8' && eventCode === 'F8') ||
              (keyPart === 'F9' && eventCode === 'F9') ||
              (keyPart === 'F10' && eventCode === 'F10') ||
              (keyPart === 'F11' && eventCode === 'F11') ||
              (keyPart === 'F12' && eventCode === 'F12')
          }
          
          return ctrlMatch && cmdMatch && shiftMatch && altMatch && metaMatch && keyMatch
        }
        
        terminal.attachCustomKeyEventHandler(event => {
          if (event.type !== 'keydown') return true
          
          const settings = shortcutSettingsRef.current
          
          // 拦截所有使用 Alt/Option 的应用级快捷键，防止 macOS 产生特殊字符
          if (matchShortcut(event, settings.splitHorizontal)) {
            return false
          }
          if (matchShortcut(event, settings.splitVertical)) {
            return false
          }
          if (matchShortcut(event, settings.newSession)) {
            return false
          }
          if (matchShortcut(event, settings.closeSession)) {
            return false
          }
          if (matchShortcut(event, settings.nextSession)) {
            return false
          }
          if (matchShortcut(event, settings.prevSession)) {
            return false
          }
          if (matchShortcut(event, settings.fullscreen)) {
            return false
          }
          
          if (matchShortcut(event, settings.clearScreen)) {
            terminal.clear()
            return false
          }
          
          if (matchShortcut(event, settings.copy)) {
            const selection = terminal.getSelection()
            if (selection) {
              writeText(selection).catch(err => {
                console.error('复制失败:', err)
              })
            }
            return false
          }
          
          if (matchShortcut(event, settings.paste)) {
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

        let resizeTimer: ReturnType<typeof setTimeout> | null = null
        const resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) {
            clearTimeout(resizeTimer)
          }
          resizeTimer = setTimeout(() => {
            const addon = fitAddons.current[key]
            if (addon) {
              try { addon.fit() } catch {}
            }
            resizeTimer = null
          }, 150)
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
    setActiveSearchSessionKey(contextMenu.sessionKey)
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
    const matchShortcut = (event: KeyboardEvent, shortcut: string): boolean => {
      if (!shortcut) return false
      
      const parts = shortcut.toUpperCase().split('+')
      const modifiers = ['CTRL', 'CMD', 'SHIFT', 'ALT', 'META']
      const hasModifiers = parts.some(p => modifiers.includes(p))
      
      const hasCtrl = parts.includes('CTRL')
      const hasCmd = parts.includes('CMD')
      const hasShift = parts.includes('SHIFT')
      const hasAlt = parts.includes('ALT')
      const hasMeta = parts.includes('META')
      const keyPart = parts.find(p => !modifiers.includes(p))
      
      const ctrlMatch = hasCtrl ? event.ctrlKey : (!hasModifiers ? !event.ctrlKey : true)
      const cmdMatch = hasCmd ? event.metaKey : (!hasModifiers ? !event.metaKey : true)
      const shiftMatch = hasShift ? event.shiftKey : (!hasModifiers ? !event.shiftKey : true)
      const altMatch = hasAlt ? event.altKey : (!hasModifiers ? !event.altKey : true)
      const metaMatch = hasMeta ? event.metaKey : (hasCmd ? true : (!hasModifiers ? !event.metaKey : true))
      
      let keyMatch = false
      if (keyPart) {
        const eventKey = event.key.toUpperCase()
        const eventCode = event.code.toUpperCase()
        
        keyMatch = eventKey === keyPart ||
          eventCode === 'KEY' + keyPart ||
          eventCode === keyPart ||
          (keyPart === 'ENTER' && (eventKey === 'ENTER' || eventCode === 'ENTER')) ||
          ((keyPart === 'ARROWRIGHT' || keyPart === 'RIGHT') && (eventKey === 'ARROWRIGHT' || eventCode === 'ARROWRIGHT')) ||
          ((keyPart === 'ARROWLEFT' || keyPart === 'LEFT') && (eventKey === 'ARROWLEFT' || eventCode === 'ARROWLEFT')) ||
          ((keyPart === 'ARROWUP' || keyPart === 'UP') && (eventKey === 'ARROWUP' || eventCode === 'ARROWUP')) ||
          ((keyPart === 'ARROWDOWN' || keyPart === 'DOWN') && (eventKey === 'ARROWDOWN' || eventCode === 'ARROWDOWN')) ||
          (keyPart === 'SPACE' && (eventKey === ' ' || eventCode === 'SPACE')) ||
          (keyPart === 'TAB' && (eventKey === 'TAB' || eventCode === 'TAB')) ||
          (keyPart === 'ESCAPE' && (eventKey === 'ESCAPE' || eventCode === 'ESCAPE')) ||
          (keyPart === 'BACKSPACE' && (eventKey === 'BACKSPACE' || eventCode === 'BACKSPACE')) ||
          (keyPart === 'DELETE' && (eventKey === 'DELETE' || eventCode === 'DELETE')) ||
          (keyPart === 'F1' && eventCode === 'F1') ||
          (keyPart === 'F2' && eventCode === 'F2') ||
          (keyPart === 'F3' && eventCode === 'F3') ||
          (keyPart === 'F4' && eventCode === 'F4') ||
          (keyPart === 'F5' && eventCode === 'F5') ||
          (keyPart === 'F6' && eventCode === 'F6') ||
          (keyPart === 'F7' && eventCode === 'F7') ||
          (keyPart === 'F8' && eventCode === 'F8') ||
          (keyPart === 'F9' && eventCode === 'F9') ||
          (keyPart === 'F10' && eventCode === 'F10') ||
          (keyPart === 'F11' && eventCode === 'F11') ||
          (keyPart === 'F12' && eventCode === 'F12')
      }
      
      return ctrlMatch && cmdMatch && shiftMatch && altMatch && metaMatch && keyMatch
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchShortcut(e, shortcutSettings.search)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        const activeSess = activeConn ? getActiveSessionInPane(activeConn.rootPane) : null
        if (activeSess) {
          const key = `${activeSess.connectionId}_${activeSess.id}`
          const term = terminalInstances.current[key]
          if (term && term.hasSelection()) {
            setSearchText(term.getSelection())
          }
          setActiveSearchSessionKey(prev => prev === key ? null : key)
        }
        return
      }
      
      if (matchShortcut(e, shortcutSettings.splitHorizontal)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (activeSess && pane) {
            invoke<string>('get_shell', { id: activeConn.connectionId }).then(newShellId => {
              const newPaneId = Date.now().toString()
              splitPane(activeConn.connectionId, pane.id, 'horizontal', newPaneId, newShellId)
            }).catch(err => {
              message.error(`分屏失败: ${err}`)
            })
          }
        }
        return
      }
      
      if (matchShortcut(e, shortcutSettings.splitVertical)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (activeSess && pane) {
            invoke<string>('get_shell', { id: activeConn.connectionId }).then(newShellId => {
              const newPaneId = Date.now().toString()
              splitPane(activeConn.connectionId, pane.id, 'vertical', newPaneId, newShellId)
            }).catch(err => {
              message.error(`分屏失败: ${err}`)
            })
          }
        }
        return
      }
      
      if (matchShortcut(e, shortcutSettings.newSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (pane) {
            invoke<string>('get_shell', { id: activeConn.connectionId }).then(newShellId => {
              addSessionToPane(activeConn.connectionId, pane.id, newShellId)
            }).catch(err => {
              message.error(`新建会话失败: ${err}`)
            })
          }
        }
        return
      }
      
      if (matchShortcut(e, shortcutSettings.closeSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          if (activeSess) {
            const pane = findPaneBySessionId(activeConn.rootPane, activeSess.id)
            handleCloseSession(activeConn.connectionId, activeSess.id, pane?.id)
          }
        }
        return
      }
      
if (matchShortcut(e, shortcutSettings.nextSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (pane && pane.sessions.length > 1) {
            const currentIndex = pane.sessions.findIndex(s => s.id === activeSess?.id)
            const nextIndex = (currentIndex + 1) % pane.sessions.length
            setActiveSessionInPane(activeConn.connectionId, pane.id, pane.sessions[nextIndex].id)
          }
        }
        return
      }
      
      if (matchShortcut(e, shortcutSettings.prevSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (pane && pane.sessions.length > 1) {
            const currentIndex = pane.sessions.findIndex(s => s.id === activeSess?.id)
            const prevIndex = (currentIndex - 1 + pane.sessions.length) % pane.sessions.length
            setActiveSessionInPane(activeConn.connectionId, pane.id, pane.sessions[prevIndex].id)
          }
        }
        return
      }
      
      if (matchShortcut(e, shortcutSettings.fullscreen)) {
        e.preventDefault()
        handleToggleFullscreen('')
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activeConnectionId, connectedConnections, shortcutSettings, splitPane, addSessionToPane, setActiveSessionInPane, handleCloseSession, handleToggleFullscreen, message])

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
      const isHorizontal = pane.splitDirection !== 'vertical'
      return (
        <Group
          key={getPaneStructureKey(pane)}
          orientation={pane.splitDirection === 'vertical' ? 'vertical' : 'horizontal'}
          style={{ height: '100%', width: '100%' }}
        >
          {pane.children.flatMap((child, index) => {
            const elements: React.ReactNode[] = []
            if (index > 0) {
              elements.push(
                <Separator
                  key={`sep-${child.id}`}
                  style={{
                    background: 'var(--color-border)',
                    width: isHorizontal ? 1 : undefined,
                    height: isHorizontal ? undefined : 1,
                  }}
                />
              )
            }
            elements.push(
              <Panel key={child.id} defaultSize={layout[index]} minSize={20}>
                {renderSplitPane(child, connectionId)}
              </Panel>
            )
            return elements
          })}
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
          onDragStart={(sid, cid, title) => {
        if (dragTimerRef.current) clearTimeout(dragTimerRef.current)
        dragTimerRef.current = setTimeout(() => {
          document.body.style.userSelect = 'none'
          dragStartRef.current = { sessionId: sid, connectionId: cid, title }
          draggedSessionRef.current = { sessionId: sid, connectionId: cid, title }
          setDraggedSession({ sessionId: sid, connectionId: cid, title })
        }, 500)
      }}
        />
      ),
      children: (
        <div
          ref={el => { terminalRefs.current[`${connectionId}_${s.id}`] = el }}
          style={{ 
            height: '100%', 
            background: 'var(--color-bg-container)', 
            overflow: 'hidden', 
            boxSizing: 'border-box', 
            padding: 4,
          }}
          onContextMenu={(e) => handleContextMenu(e, `${connectionId}_${s.id}`)}
          onClick={() => setActiveSessionInPane(connectionId, pane.id, s.id)}
        />
      ),
    }))

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
        
        <PaneToolbar
          sessionKey={`${connectionId}_${activeSess.id}`}
          searchAddons={searchAddons}
          shortcutSettings={shortcutSettings}
          hasSplitPanel={hasSplitChildren(activeConnection?.rootPane || null)}
          searchVisible={activeSearchSessionKey === `${connectionId}_${activeSess.id}`}
          searchText={searchText}
          searchMode={searchMode}
          onToggleSearch={() => {
            const currentKey = `${connectionId}_${activeSess.id}`
            if (activeSearchSessionKey === currentKey) {
              setActiveSearchSessionKey(null)
            } else {
              setActiveSearchSessionKey(currentKey)
            }
          }}
          onSearchTextChange={setSearchText}
          onSearchModeChange={setSearchMode}
          onSplitHorizontal={async () => {
            try {
              const newShellId = await invoke<string>('get_shell', { id: connectionId })
              const newPaneId = Date.now().toString()
              splitPane(connectionId, pane.id, 'horizontal', newPaneId, newShellId)
            } catch (err) {
              message.error(`分屏失败: ${err}`)
            }
          }}
          onSplitVertical={async () => {
            try {
              const newShellId = await invoke<string>('get_shell', { id: connectionId })
              const newPaneId = Date.now().toString()
              splitPane(connectionId, pane.id, 'vertical', newPaneId, newShellId)
            } catch (err) {
              message.error(`分屏失败: ${err}`)
            }
          }}
          onCloseSplit={async () => {
            const conn = connectedConnections.find(c => c.connectionId === connectionId)
            if (!conn || !hasSplitChildren(conn.rootPane)) return
            for (const s of pane.sessions) {
              const key = `${connectionId}_${s.id}`
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
            closePane(connectionId, pane.id)
          }}
          onClear={() => {
            const term = terminalInstances.current[`${connectionId}_${activeSess.id}`]
            if (term) term.clear()
          }}
          onExport={() => {
            const term = terminalInstances.current[`${connectionId}_${activeSess.id}`]
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
          }}
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
          tabBarStyle={{ margin: 0, padding: '0 4px', background: 'var(--color-bg-elevated)', minHeight: 24, height: 24 }}
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
          connectionName={conn.connection.name}
          label={
            <span style={{ color: conn.connection.group === '生产环境' ? '#E65100' : 'var(--color-text)', fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>
              {conn.connection.username}@{conn.connection.host}
              <CloseOutlined 
                style={{ marginLeft: 4, fontSize: 9 }} 
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); handleCloseConnection(conn.connectionId) }} 
              />
            </span>
          }
        />
      ),
      children: <div />,
    }
  })

  // 拖拽连接 tab 到新窗口功能（暂时禁用）
  // const handleConnectionDragStart = (event: DragStartEvent) => {
  //   connectionDragIdRef.current = String(event.active.id)
  //   setIsConnectionDragging(true)
  //   setConnectionTabDragToNewWindow(false)
  // }

  // const handleConnectionDragEnd = async (event: DragEndEvent) => {
  //   const { active, over } = event
  //   const connectionId = connectionDragIdRef.current
  //   
  //   setIsConnectionDragging(false)
  //   connectionDragIdRef.current = null
  //   
  //   if (connectionTabDragToNewWindow && connectionId) {
  //     const conn = connectedConnections.find(c => c.connectionId === connectionId)
  //     if (conn) {
  //       try {
  //         const sessions = getAllSessions(conn.rootPane)
  //         const sessionsWithShell = sessions.filter(s => s.shellId)
  //         
  //         if (sessionsWithShell.length > 0) {
  //           const sessionsJson = JSON.stringify(sessionsWithShell.map(s => ({
  //             id: s.id,
  //             shellId: s.shellId,
  //             title: s.title,
  //           })))
  //           
  //           await invoke<string>('create_terminal_window', {
  //             connectionId: connectionId,
  //             sessionsJson: sessionsJson,
  //             connectionName: conn.connection.name,
  //           })
  //           
  //           for (const s of sessions) {
  //             const key = `${connectionId}_${s.id}`
  //             if (unlistenersRef.current[key]) {
  //               unlistenersRef.current[key]()
  //               delete unlistenersRef.current[key]
  //             }
  //             if (terminalInstances.current[key]) {
  //               terminalInstances.current[key].dispose()
  //               delete terminalInstances.current[key]
  //             }
  //             delete fitAddons.current[key]
  //             delete searchAddons.current[key]
  //             delete resizeObserversRef.current[key]
  //             initializedRef.current.delete(key)
  //           }
  //           
  //           removeConnectionFromStore(connectionId)
  //         } else {
  //           message.warning('该连接没有活动的终端会话')
  //         }
  //       } catch (err) {
  //         message.error(`创建新窗口失败: ${err}`)
  //       }
  //     }
  //     setConnectionTabDragToNewWindow(false)
  //     return
  //   }
  //   
  //   if (over && active.id !== over.id) {
  //     const oldIndex = connectedConnections.findIndex(c => c.connectionId === active.id)
  //     const newIndex = connectedConnections.findIndex(c => c.connectionId === over.id)
  //     if (oldIndex !== -1 && newIndex !== -1) {
  //       reorderConnections(oldIndex, newIndex)
  //     }
  //   }
  //   
  //   setConnectionTabDragToNewWindow(false)
  // }

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
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          background: 'var(--color-bg-elevated)',
          padding: '0 8px',
          gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleConnectionDragEnd}>
              <SortableContext items={connectedConnections.map(c => c.connectionId)} strategy={horizontalListSortingStrategy}>
                <Tabs
                  activeKey={activeConnectionId || undefined}
                  onChange={setActiveConnection}
                  items={[...connectionItems, ...disconnectedItems]}
                  style={{ height: 40 }}
                  tabBarStyle={{ margin: 0, padding: '0 4px', background: 'transparent' }}
                  destroyInactiveTabPane={false}
                />
              </SortableContext>
            </DndContext>
          </div>
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏'}>
            <Button
              type="text"
              size="small"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => handleToggleFullscreen('')}
              style={{ color: 'var(--color-text-tertiary)' }}
            />
          </Tooltip>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {connectedConnections.map(conn => (
            <div 
              key={conn.connectionId} 
              style={{ height: '100%', display: activeConnectionId === conn.connectionId ? 'flex' : 'none', flexDirection: 'column' }}
            >
              {renderSplitPane(conn.rootPane, conn.connectionId)}
            </div>
          ))}
        </div>
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

      {contextMenu.visible && (
        <div
          id="terminal-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: 'var(--color-bg-elevated)',
            borderRadius: 4,
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            minWidth: 120,
            fontSize: 13,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handleCopy}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <CopyOutlined /> 复制
          </div>
          <div
            style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handlePaste}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <SnippetsOutlined /> 粘贴
          </div>
          <div
            style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handleSelectAll}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <CheckCircleOutlined /> 全选
          </div>
          <div
            style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={handleFindFromContextMenu}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <SearchOutlined /> 查找
          </div>
          <div style={{ height: 1, background: 'var(--color-border)', margin: '3px 0' }} />
          {isContextMenuOnSplitPanel() ? (
            <div
              style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={handleCloseSplitFromContextMenu}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <CloseOutlined /> 关闭分屏
            </div>
          ) : (
            <>
              <div
                style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={handleSplitHorizontalFromContextMenu}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <BorderHorizontalOutlined /> 水平分屏
              </div>
              <div
                style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
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
      
      {draggedSession && dragPosition ? createPortal(
        <span
          style={{
            position: 'fixed',
            left: dragPosition.x,
            top: dragPosition.y,
            fontSize: 12,
            cursor: 'grabbing',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0,
            padding: '0 6px',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px 4px 0 0',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            zIndex: 10000,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            lineHeight: 1.4,
          }}
        >
          <HolderOutlined style={{ fontSize: 10, color: 'var(--color-text-quaternary)', marginRight: 2 }} />
          <span style={{ lineHeight: 1 }}>{draggedSession.title}</span>
          <CloseOutlined style={{ marginLeft: 4, fontSize: 9, color: 'var(--color-text-quaternary)' }} />
        </span>,
        document.body
      ) : null}
      
      {/* 拖拽连接 tab 到新窗口功能（暂时禁用） */}
      {/* {connectionTabDragToNewWindow && createPortal(
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          border: '4px solid var(--color-primary)',
          pointerEvents: 'none',
          zIndex: 9999,
          boxShadow: 'inset 0 0 40px rgba(0, 185, 107, 0.4)',
          background: 'rgba(0, 185, 107, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--color-primary)',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0, 185, 107, 0.4)',
          }}>
            ↗ 释放以在新窗口打开
          </div>
        </div>,
        document.body
      )} */}
    </div>
  )
}

export default Terminal
