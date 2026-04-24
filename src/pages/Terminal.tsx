import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { Tabs, App, Button, Tooltip, Input, Modal, List, Popconfirm } from 'antd'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  CloseOutlined,
  PlusOutlined,
  HolderOutlined,
  DisconnectOutlined,
  CopyOutlined,
  SnippetsOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  BorderHorizontalOutlined,
  BorderVerticleOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { Panel, Group, Separator } from 'react-resizable-panels'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore, DisconnectReason, SplitPane } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { useHistoryStore } from '../stores/historyStore'
import { resolveTerminalTheme } from '../styles/themes/terminal-themes'
import type { TerminalThemeColors } from '../types/theme'

function computeGhostColor(foreground: string): string {
  const rgbaMatch = foreground.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaMatch) {
    const r = rgbaMatch[1]
    const g = rgbaMatch[2]
    const b = rgbaMatch[3]
    const originalAlpha = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1
    return `rgba(${r}, ${g}, ${b}, ${(originalAlpha * 0.6).toFixed(2)})`
  }
  if (foreground.startsWith('#') && foreground.length === 7) {
    return foreground + '99'
  }
  return foreground
}

const GhostTextOverlay = React.forwardRef<HTMLDivElement, {
  sessionKey: string
  fontFamily?: string
  fontSize?: number
  themeColors: TerminalThemeColors
}>(function GhostTextOverlay({
  sessionKey,
  fontFamily,
  fontSize,
  themeColors,
}, ref) {
  const ghostColor = React.useMemo(() => {
    return computeGhostColor(themeColors.foreground)
  }, [themeColors.foreground])

  return (
    <div
      ref={ref}
      data-session-key={sessionKey}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        color: ghostColor,
        fontFamily: fontFamily || 'Menlo, Monaco, monospace',
        fontSize: fontSize || 14,
        pointerEvents: 'none',
        zIndex: 1000,
        whiteSpace: 'pre',
        display: 'none',
        overflow: 'visible',
        maxWidth: 'none',
        width: 'auto',
        transform: 'translateY(-0.02em)',
      }}
    />
  )
})

import { RightSidebar } from '../components/RightSidebar'
import MonitorPanel from '../components/MonitorPanel'
import FileManagerPanel from '../components/FileManagerPanel'
import McpLogPanel from '../components/McpLogPanel'
import { STORAGE_KEYS } from '../config/constants'
import { useFullscreen, useContextMenu, useRightPanels } from './terminal/hooks'
import { PaneToolbar, SortableTab, DraggableSessionTab } from './terminal/components'
import { ShortcutHelpModal } from './terminal/components/ShortcutHelpModal'
import { DragToNewWindowOverlay } from './terminal/components/DragToNewWindowOverlay'
import { useConnectionDragToNewWindow } from './terminal/hooks/useConnectionDrag'
import { getAllSessions, getActiveSessionInPane, findPaneBySessionId, hasSplitChildren, getVisibleSessions } from '../utils/paneUtils'
import { getRecentConnections, recordConnectionHistory } from '../services/database'
import { createCommandTracker, CommandTracker } from '../utils/shellOutputParser'
import type { Connection } from '../types/shared'

interface TerminalProps {
  singleConnectionMode?: boolean
}

// 获取分组 CSS 类名（用于环境标签主题适配）
function getGroupClass(group: string): string {
  const map: Record<string, string> = {
    '生产环境': 'group-accent-production',
    '开发环境': 'group-accent-development',
    '测试环境': 'group-accent-test',
  }
  return map[group] || 'group-accent-default'
}

function Terminal({ singleConnectionMode = false }: TerminalProps) {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const activeConnectionId = useTerminalStore(state => state.activeConnectionId)
  const setActiveConnection = useTerminalStore(state => state.setActiveConnection)
  const closeSession = useTerminalStore(state => state.closeSession)
  const closeConnection = useTerminalStore(state => state.closeConnection)
  const removeConnectionFromStore = useTerminalStore(state => state.removeConnectionFromStore)
  const markConnectionDisconnected = useTerminalStore(state => state.markConnectionDisconnected)
  const clearConnectionDisconnected = useTerminalStore(state => state.clearConnectionDisconnected)
  const setConnectionReconnecting = useTerminalStore(state => state.setConnectionReconnecting)
  const addConnection = useTerminalStore(state => state.addConnection)
  const updateSessionShellId = useTerminalStore(state => state.updateSessionShellId)
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
  const selectedTheme = useThemeStore(state => state.selectedTheme)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const [recentConnections, setRecentConnections] = useState<Connection[]>([])

  const refreshRecentConnections = useCallback(async () => {
    try {
      const recent = await getRecentConnections(5)
      setRecentConnections(recent)
    } catch (error) {
      console.error('[Terminal] Failed to refresh recent connections:', error)
    }
  }, [])

  useEffect(() => {
    refreshRecentConnections()
  }, [refreshRecentConnections])

  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const terminalInstances = useRef<{ [key: string]: XTerm }>({})
  const fitAddons = useRef<{ [key: string]: FitAddon }>({})
  const initializedRef = useRef<Set<string>>(new Set())
  const unlistenersRef = useRef<{ [key: string]: UnlistenFn }>({})
  const resizeObserversRef = useRef<{ [key: string]: ResizeObserver }>({})
  const searchAddons = useRef<{ [key: string]: SearchAddon }>({})
  const shellIdsRef = useRef<{ [key: string]: string }>({})
  const apiLogVisibleRef = useRef(false)
  const shortcutSettingsRef = useRef(shortcutSettings)
  const terminalSettingsRef = useRef(terminalSettings)
  const connectedConnectionsRef = useRef(connectedConnections)
  const currentInputRef = useRef<{ [key: string]: string }>({})
  const ghostTextRef = useRef<{ [key: string]: { input: string, suggestion: string, allSuggestions: string[], currentIndex: number } }>({})
  const ghostTextOverlayRef = useRef<{ [key: string]: { top: number, left: number, text: string } }>({})
  const ghostTextElementsRef = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const ghostTextCellHeightRef = useRef<{ [key: string]: number }>({})
  const ghostTextStartXRef = useRef<{ [key: string]: number }>({})
  const ghostTextLineRef = useRef<{ [key: string]: number }>({})
  const commandTrackersRef = useRef<{ [key: string]: CommandTracker }>({})
  
  const updateGhostTextOverlay = useCallback((key: string, top: number, left: number, text: string, cellHeight?: number) => {
    const el = ghostTextElementsRef.current[key]
    if (el) {
      el.style.top = top + 'px'
      el.style.left = left + 'px'
      el.textContent = text
      el.style.display = text ? 'block' : 'none'
      if (cellHeight) {
        el.style.lineHeight = cellHeight + 'px'
      }
    }
    ghostTextOverlayRef.current[key] = { top, left, text }
  }, [])
  
const matchAndUpdateGhostText = useCallback((key: string, connId: string, input: string, suggestionIndex: number = 0) => {
    if (!input) {
      ghostTextRef.current[key] = { input: '', suggestion: '', allSuggestions: [], currentIndex: 0 }
      updateGhostTextOverlay(key, 0, 0, '')
      return
    }

    const { caches } = useHistoryStore.getState()
    const cache = caches.get(connId) || []

    if (cache.length === 0) {
      ghostTextRef.current[key] = { input: '', suggestion: '', allSuggestions: [], currentIndex: 0 }
      updateGhostTextOverlay(key, 0, 0, '')
      return
    }

    const normalizedInput = input.toLowerCase().replace(/\s+/g, ' ')
    const allMatches = cache.filter(cmd => {
      const normalizedCmd = cmd.text.toLowerCase().replace(/\s+/g, ' ')
      return normalizedCmd.startsWith(normalizedInput) && normalizedCmd.length > normalizedInput.length
    }).slice(0, 10)

    if (allMatches.length > 0) {
      const safeIndex = Math.min(suggestionIndex, allMatches.length - 1)
      const match = allMatches[safeIndex]
      const normalizedMatch = match.text.toLowerCase().replace(/\s+/g, ' ')
      const remainingPart = normalizedMatch.slice(normalizedInput.length)
      const suggestion = remainingPart
      const allSuggestions = allMatches.map(m => {
        const nm = m.text.toLowerCase().replace(/\s+/g, ' ')
        return nm.slice(normalizedInput.length)
      })
      ghostTextRef.current[key] = { input, suggestion, allSuggestions, currentIndex: safeIndex }

      const term = terminalInstances.current[key]
      const container = terminalRefs.current[key]

      if (term && container && term.element) {
        try {
          const buffer = term.buffer.active
          const cursorY = buffer.cursorY

          const xtermScreen = term.element.querySelector('.xterm-screen')
          const xtermRows = term.element.querySelector('.xterm-rows')
          const firstRow = term.element.querySelector('.xterm-row')
          
          if (!xtermScreen || !xtermRows) {
            updateGhostTextOverlay(key, 0, 0, '')
            return
          }

          const screenRect = xtermScreen.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()

          let actualCellHeight: number
          if (firstRow) {
            actualCellHeight = firstRow.getBoundingClientRect().height
          } else {
            actualCellHeight = screenRect.height / (term.rows || 24)
          }

          const actualCellWidth = screenRect.width / (term.cols || 80)

          const offsetX = screenRect.left - containerRect.left
          const screenOffsetTop = screenRect.top - containerRect.top

          ghostTextCellHeightRef.current[key] = actualCellHeight

          const startX = ghostTextStartXRef.current[key] ?? buffer.cursorX
          
          const ghostX = startX + input.length

          updateGhostTextOverlay(
            key,
            screenOffsetTop + cursorY * actualCellHeight,
            offsetX + ghostX * actualCellWidth,
            suggestion,
            actualCellHeight
          )
        } catch {
          updateGhostTextOverlay(key, 0, 0, '')
        }
      }
    } else {
      ghostTextRef.current[key] = { input: '', suggestion: '', allSuggestions: [], currentIndex: 0 }
      updateGhostTextOverlay(key, 0, 0, '')
    }
  }, [updateGhostTextOverlay])
  
  const clearGhostText = useCallback((key: string) => {
    ghostTextRef.current[key] = { input: '', suggestion: '', allSuggestions: [], currentIndex: 0 }
    delete ghostTextStartXRef.current[key]
    delete ghostTextLineRef.current[key]
    updateGhostTextOverlay(key, 0, 0, '')
  }, [updateGhostTextOverlay])
  
  const switchSuggestion = useCallback((key: string, connId: string, direction: 'next' | 'prev') => {
    const ghost = ghostTextRef.current[key]
    if (!ghost || ghost.allSuggestions.length === 0) return
    
    let newIndex = ghost.currentIndex
    if (direction === 'next') {
      newIndex = (ghost.currentIndex + 1) % ghost.allSuggestions.length
    } else {
      newIndex = ghost.currentIndex === 0 ? ghost.allSuggestions.length - 1 : ghost.currentIndex - 1
    }
    
    matchAndUpdateGhostText(key, connId, ghost.input, newIndex)
  }, [matchAndUpdateGhostText])
  
  const loadHistory = useHistoryStore(state => state.loadHistory)
  const addCommand = useHistoryStore(state => state.addCommand)
  const historyCaches = useHistoryStore(state => state.caches)
  const clearConnectionHistory = useHistoryStore(state => state.clearConnectionHistory)
  
  useEffect(() => {
    shortcutSettingsRef.current = shortcutSettings
  }, [shortcutSettings])

  useEffect(() => {
    terminalSettingsRef.current = terminalSettings
  }, [terminalSettings])

  useEffect(() => {
    connectedConnectionsRef.current = connectedConnections
  }, [connectedConnections])
  
  const {
    isFullscreen,
    handleToggleFullscreen,
  } = useFullscreen(setSidebarCollapsed, fitAddons)

  const [historyModalVisible, setHistoryModalVisible] = useState(false)
  const [historyModalKey, setHistoryModalKey] = useState<string | null>(null)
  const [historySearchText, setHistorySearchText] = useState('')
  const [historySelectedIndex, setHistorySelectedIndex] = useState(0)

  useEffect(() => {
    if (historyModalVisible) {
      const timer = setTimeout(() => {
        const input = document.getElementById('history-search-input') as HTMLInputElement
        if (input) {
          input.focus()
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [historyModalVisible])

  const showHistoryModal = useCallback((key: string) => {
    const [connId] = key.split('_')
    loadHistory(connId)
    setHistoryModalKey(key)
    setHistoryModalVisible(true)
    setHistorySearchText('')
    setHistorySelectedIndex(0)
  }, [loadHistory])

  const hideHistoryModal = useCallback(() => {
    const key = historyModalKey
    setHistoryModalVisible(false)
    setHistoryModalKey(null)
    setHistorySearchText('')
    setHistorySelectedIndex(0)

    if (key) {
      requestAnimationFrame(() => {
        const term = terminalInstances.current[key]
        if (term) {
          term.focus()
        }
      })
    }
  }, [historyModalKey])

  const toggleShortcutHelp = useCallback(() => {
    setShortcutHelpVisible(prev => !prev)
  }, [])

  const selectHistoryCommand = useCallback((command: string) => {
    if (!historyModalKey) return
    const key = historyModalKey
    const currentShellId = shellIdsRef.current[key]
    if (currentShellId) {
      invoke('write_shell', { id: currentShellId, data: command }).catch(err => {
        console.error('写入终端失败:', err)
      })
      currentInputRef.current[key] = command
    }
    hideHistoryModal()
    requestAnimationFrame(() => {
      const term = terminalInstances.current[key]
      if (term) {
        term.focus()
      }
    })
  }, [historyModalKey, hideHistoryModal])

  useEffect(() => {
    if (!historyModalVisible || !historyModalKey) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const { caches } = useHistoryStore.getState()
      const [connId] = historyModalKey.split('_')
      const cache = caches.get(connId) || []
      const filtered = historySearchText
        ? cache.filter(c => c.text.toLowerCase().includes(historySearchText.toLowerCase()))
        : cache
      const maxIndex = Math.min(filtered.length, 50) - 1

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHistorySelectedIndex(i => i > 0 ? i - 1 : maxIndex)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHistorySelectedIndex(i => i < maxIndex ? i + 1 : 0)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = filtered[historySelectedIndex]
        if (item) selectHistoryCommand(item.text)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [historyModalVisible, historyModalKey, historySearchText, historySelectedIndex, selectHistoryCommand])

  const {
    contextMenu,
    handleContextMenu,
    hideContextMenu,
  } = useContextMenu()

  const [searchText, setSearchText] = useState('')
  const [searchMode, setSearchMode] = useState<'normal' | 'regex' | 'wholeWord'>('normal')
  const [activeSearchSessionKey, setActiveSearchSessionKey] = useState<string | null>(null)
  const [shortcutHelpVisible, setShortcutHelpVisible] = useState(false)

  const {
    monitorVisible,
    setMonitorVisible,
    apiLogVisible,
    setApiLogVisible,
  } = useRightPanels(activeConnectionId, fileManagerVisible, setFileManagerVisible)

  const [mcpEnabled, setMcpEnabled] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MCP_ENABLED)
    return saved ? saved === 'true' : false
  })

  const [draggedSession, setDraggedSession] = useState<{ sessionId: string; connectionId: string; title: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ paneId: string; connectionId: string; direction: 'left' | 'right' | 'top' | 'bottom' } | null>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const paneRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const draggedSessionRef = useRef<{ sessionId: string; connectionId: string; title: string } | null>(null)
  const dropTargetRef = useRef<{ paneId: string; connectionId: string; direction: 'left' | 'right' | 'top' | 'bottom' } | null>(null)
  const dragStartRef = useRef<{ sessionId: string; connectionId: string; title: string } | null>(null)
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 拖拽连接 tab 到新窗口功能
  const [isConnectionDragging, setIsConnectionDragging] = useState(false)
  const connectionDragIdRef = useRef<string | null>(null)
  const { isDragToNewWindow, setIsDragToNewWindow } = useConnectionDragToNewWindow(isConnectionDragging)

  useEffect(() => {
    draggedSessionRef.current = draggedSession
  }, [draggedSession])

  useEffect(() => {
    dropTargetRef.current = dropTarget
  }, [dropTarget])

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
  
  const currentThemeColors = useMemo(
    () => resolveTerminalTheme(selectedTheme, appTheme, terminalThemeKey),
    [selectedTheme, appTheme, terminalThemeKey]
  )
  
  const activeConnection = connectedConnections.find(c => c.connectionId === activeConnectionId)
  const visibleSessionsKey = activeConnection
    ? getVisibleSessions(activeConnection.rootPane).map(s => `${s.connectionId}_${s.id}_${s.shellId ?? ''}`).join('|')
    : ''
  const visibleSessions = useMemo(
    () => activeConnection ? getVisibleSessions(activeConnection.rootPane) : [],
    [visibleSessionsKey]
  )
  
  useEffect(() => {
    const instances = Object.values(terminalInstances.current)
    for (let i = 0; i < instances.length; i++) {
      const term = instances[i]
      if (term) {
        term.options.theme = currentThemeColors
        term.refresh(0, term.rows - 1)
      }
    }
  }, [currentThemeColors])
  
  // 强制在新窗口模式下等待 store 数据
  const [storeReady, setStoreReady] = useState(false)
  useEffect(() => {
    if (singleConnectionMode && connectedConnections.length > 0 && activeConnectionId) {
      setStoreReady(true)
    }
  }, [singleConnectionMode, connectedConnections.length, activeConnectionId])

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
      const timer1 = setTimeout(() => {
        Object.values(fitAddons.current).forEach(addon => {
          try { addon?.fit() } catch {}
        })
      }, 100)
      const timer2 = setTimeout(() => {
        Object.values(fitAddons.current).forEach(addon => {
          try { addon?.fit() } catch {}
        })
      }, 300)
      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
      }
    }
    paneStructureRef.current = structureKey
  }, [activeConnection, activeConnection?.rootPane])

  useEffect(() => {
    // 在 singleConnectionMode 下等待 store 数据准备好
    if (singleConnectionMode && !storeReady) {
      return
    }
    
    if (visibleSessions.length === 0) {
      return
    }

    const sessionsToInit = visibleSessions
    
    // setTimeout 确保 ref 回调已执行
    const timerId = setTimeout(() => {
      for (const session of sessionsToInit) {
        if (!session.shellId) {
          continue
        }

        const key = `${session.connectionId}_${session.id}`
        const shellId = session.shellId
        const connId = session.connectionId

        if (initializedRef.current.has(key)) {
          const term = terminalInstances.current[key]
          const existingContainer = terminalRefs.current[key]

          if (term && existingContainer && term.element && !existingContainer.contains(term.element)) {
            existingContainer.innerHTML = ''
            existingContainer.appendChild(term.element)
            requestAnimationFrame(() => {
              try { term.focus() } catch {}
            })
          }
          continue
        }

        const container = terminalRefs.current[key]
        if (!container) {
          continue
        }

        const initTerminal = async () => {
          const waitForContainerSize = (): Promise<void> => {
            return new Promise((resolve, reject) => {
              let attempts = 0
              const maxAttempts = 100
              const checkSize = () => {
                const rect = container.getBoundingClientRect()
                if (rect.width > 0 && rect.height > 0) {
                  resolve()
                } else {
                  attempts++
                  if (attempts >= maxAttempts) {
                    reject(new Error(`Container size timeout: ${rect.width}x${rect.height}`))
                  } else {
                    requestAnimationFrame(checkSize)
                  }
                }
              }
              checkSize()
            })
          }

          try {
            await waitForContainerSize()
          } catch (err) {
            console.error('[Terminal] waitForContainerSize failed:', err)
            throw err
          }

          const terminal = new XTerm({
            cursorBlink: terminalSettings.cursorBlink,
            cursorStyle: terminalSettings.cursorStyle,
            fontSize: terminalSettings.fontSize,
            fontFamily: `${terminalSettings.fontFamily}, Menlo, Monaco, "Courier New", monospace`,
            theme: currentThemeColors,
            convertEol: true,
            disableStdin: false,
            scrollback: terminalSettings.scrollback,
            macOptionIsMeta: true,
          })

          const fitAddon = new FitAddon()
          terminal.loadAddon(fitAddon)
          
          const ghostOverlayElement = ghostTextElementsRef.current[key]
          
          container.innerHTML = ''
          terminal.open(container)
          
          if (ghostOverlayElement) {
            container.appendChild(ghostOverlayElement)
          }

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
            
            const hasCtrl = parts.includes('CTRL')
            const hasCmd = parts.includes('CMD')
            const hasShift = parts.includes('SHIFT')
            const hasAlt = parts.includes('ALT')
            const hasMeta = parts.includes('META')
            const keyPart = parts.find(p => !modifiers.includes(p))
            
            // 修复：未声明的修饰键必须未按下才能匹配
            const ctrlMatch = hasCtrl ? event.ctrlKey : !event.ctrlKey
            const cmdMatch = hasCmd ? event.metaKey : !event.metaKey
            const shiftMatch = hasShift ? event.shiftKey : !event.shiftKey
            const altMatch = hasAlt ? event.altKey : !event.altKey
            // META 和 CMD 在 Mac 上通常对应同一个键，特殊处理
            const metaMatch = hasMeta ? event.metaKey : (hasCmd ? true : !event.metaKey)
            
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
            
            if (matchShortcut(event, settings.showHistory)) {
              showHistoryModal(key)
              return false
            }
            
            if (matchShortcut(event, settings.nextSuggestion)) {
              const ghost = ghostTextRef.current[key]
              if (ghost && ghost.allSuggestions.length > 0) {
                switchSuggestion(key, key.split('_')[0], 'next')
              }
              return false
            }
            
            if (matchShortcut(event, settings.prevSuggestion)) {
              const ghost = ghostTextRef.current[key]
              if (ghost && ghost.allSuggestions.length > 0) {
                switchSuggestion(key, key.split('_')[0], 'prev')
              }
              return false
            }

            if (matchShortcut(event, settings.shortcutHelp)) {
              event.preventDefault()
              toggleShortcutHelp()
              return false
            }

            return true
          })

          terminal.onData(data => {
            const [connId] = key.split('_')
            const conn = connectedConnectionsRef.current.find(c => c.connectionId === connId)
            
            if (conn?.disconnected && !conn.reconnecting) {
              if (data === '\r' || data === '\n') {
                handleReconnect(connId)
              }
              return
            }
            
            if (conn?.reconnecting) {
              return
            }

            const ghost = ghostTextRef.current[key]
            
            if (data === '\x1b[C') {
              if (ghost && ghost.suggestion) {
                const currentShellId = shellIdsRef.current[key]
                if (currentShellId) {
                  invoke('write_shell', { id: currentShellId, data: ghost.suggestion }).catch(err => {
                    console.error('写入终端失败:', err)
                  })
                  currentInputRef.current[key] = ghost.input + ghost.suggestion
                  ghostTextRef.current[key] = { input: ghost.input + ghost.suggestion, suggestion: '', allSuggestions: [], currentIndex: 0 }
                  updateGhostTextOverlay(key, 0, 0, '')
                }
                return
              }
            }
            
            // 处理 Ctrl+C / Ctrl+U - 清除输入和建议
            if (data === '\x03' || data === '\x15') {
              clearGhostText(key)
              currentInputRef.current[key] = ''
            }
            else if (data === '\t') {
              clearGhostText(key)
              currentInputRef.current[key] = ''
            }
            else if (data === '\x1b') {
              const ghost = ghostTextRef.current[key]
              if (ghost && ghost.suggestion) {
                clearGhostText(key)
                return
              }
            }
            else if (data === '\r' || data === '\n') {
              clearGhostText(key)
              currentInputRef.current[key] = ''
              const tracker = commandTrackersRef.current[key]
              if (tracker) {
                tracker.clearPendingCommand()
              }
            }
            // 处理退格
            else if (data === '\x7f' || data === '\b') {
              const current = currentInputRef.current[key] || ''
              if (current.length > 0) {
                const newInput = current.slice(0, -1)
                currentInputRef.current[key] = newInput
                if (newInput === '') {
                  clearGhostText(key)
                } else {
                  requestAnimationFrame(() => {
                    matchAndUpdateGhostText(key, connId, newInput)
                  })
                }
              }
            }
            // 处理普通文本输入（包括粘贴）
            else if (!data.startsWith('\x1b') && !data.includes('\r') && !data.includes('\n')) {
              const currentInput = currentInputRef.current[key] || ''
              if (currentInput === '') {
                const buffer = terminal.buffer.active
                ghostTextStartXRef.current[key] = buffer.cursorX
                ghostTextLineRef.current[key] = buffer.cursorY
              }
              const newInput = currentInput + data
              currentInputRef.current[key] = newInput
              matchAndUpdateGhostText(key, connId, newInput)
            }
            
            const currentShellId = shellIdsRef.current[key]
            if (currentShellId) {
              invoke('write_shell', { id: currentShellId, data }).catch(err => {
                console.error('写入终端失败:', err)
              })
            }
          })

          terminal.onResize(({ cols, rows }) => {
            invoke('resize_shell', { id: shellId, cols, rows }).catch(err => {
              console.error('调整终端大小失败:', err)
            })
})

          terminal.onSelectionChange(() => {
            if (terminalSettingsRef.current.copyOnSelect && terminal.hasSelection()) {
              const selection = terminal.getSelection()
              if (selection) {
                writeText(selection).catch(err => {
                  console.error('复制失败:', err)
                })
              }
            }
          })

          terminal.onScroll(() => {
            const ghost = ghostTextRef.current[key]
            if (ghost && ghost.input) {
              const [connId] = key.split('_')
              requestAnimationFrame(() => {
                matchAndUpdateGhostText(key, connId, ghost.input, ghost.currentIndex)
              })
            }
          })

          terminalInstances.current[key] = terminal
          fitAddons.current[key] = fitAddon
          shellIdsRef.current[key] = shellId
          commandTrackersRef.current[key] = createCommandTracker()

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
              
              const tracker = commandTrackersRef.current[key]
              if (tracker && typeof event.payload === 'string') {
                const result = tracker.processOutput(event.payload, term)
                if (result.command) {
                  const [connId] = key.split('_')
                  addCommand(connId, result.command)
                }
              }
            }
          })

          unlistenersRef.current[key] = unlisten

          let resizeTimer: ReturnType<typeof setTimeout> | null = null
          let resizeRAF: number | null = null
          const resizeObserver = new ResizeObserver(() => {
            if (resizeTimer) {
              clearTimeout(resizeTimer)
            }
            if (resizeRAF) {
              cancelAnimationFrame(resizeRAF)
            }
            resizeRAF = requestAnimationFrame(() => {
              resizeTimer = setTimeout(() => {
                const addon = fitAddons.current[key]
                if (addon) {
                  try { addon.fit() } catch {}
                }
                clearGhostText(key)
                resizeTimer = null
                resizeRAF = null
              }, 100)
            })
          })
          resizeObserver.observe(container)
          resizeObserversRef.current[key] = resizeObserver

          requestAnimationFrame(() => {
            try { fitAddon.fit() } catch {}
            try { terminal.focus() } catch {}
          })

          initializedRef.current.add(key)

          loadHistory(connId)

          try {
            await invoke('start_shell_reader', { id: shellId })
          } catch (err) {
            console.error('启动终端读取器失败:', err)
            message.error('启动终端失败，请重试')
          }
        }

        initTerminal().catch(err => {
            const errorMsg = '终端初始化失败: ' + String(err)
            console.error('[Terminal] initTerminal failed for', key, ':', err)
            message.error(errorMsg)
          })
      }
    }, 0)

    return () => clearTimeout(timerId)
  }, [connectedConnections.length, activeConnectionId, visibleSessionsKey, appTheme, terminalThemeKey, message, storeReady, singleConnectionMode, loadHistory])

  const reconnectTimersRef = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({})

  const getReconnectDelay = useCallback((attempt: number): number => {
    if (attempt === 1) return 3000
    if (attempt === 2) return 10000
    if (attempt === 3) return 20000
    if (attempt === 4) return 30000
    if (attempt === 5) return 45000
    return 60000
  }, [])

  const disconnectHandledRef = useRef<Set<string>>(new Set())

  const handleReconnect = useCallback(async (connectionId: string, isManual: boolean = true) => {
    const conn = connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn || conn.reconnecting) return

    setConnectionReconnecting(connectionId, true)

    const sessions = getAllSessions(conn.rootPane)
    const sessionsWithShell = sessions.filter(s => s.shellId)

    try {
      await invoke('connect_ssh', {
        id: connectionId,
        connection: {
          host: conn.connection.host,
          port: conn.connection.port,
          username: conn.connection.username,
          password: conn.connection.password,
          key_file: conn.connection.keyFile,
        }
      })

      for (const session of sessionsWithShell) {
        const key = `${connectionId}_${session.id}`
        
        if (unlistenersRef.current[key]) {
          unlistenersRef.current[key]()
          delete unlistenersRef.current[key]
        }
        if (session.shellId) {
          await invoke('close_shell', { id: session.shellId }).catch(() => {})
        }

        const newShellId = await invoke<string>('get_shell', { id: connectionId })
        updateSessionShellId(connectionId, session.id, newShellId)
        shellIdsRef.current[key] = newShellId

        const eventName = `shell-output-${newShellId}`
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

        await invoke('start_shell_reader', { id: newShellId })
      }

      clearConnectionDisconnected(connectionId)
      disconnectHandledRef.current.delete(connectionId)
      
      setTimeout(() => {
        sessionsWithShell.forEach(session => {
          const key = `${connectionId}_${session.id}`
          const addon = fitAddons.current[key]
          if (addon) {
            try { addon.fit() } catch {}
          }
        })
      }, 100)
      
      setTimeout(() => {
        sessionsWithShell.forEach(session => {
          const key = `${connectionId}_${session.id}`
          const addon = fitAddons.current[key]
          if (addon) {
            try { addon.fit() } catch {}
          }
        })
      }, 300)
      
      if (isManual) {
        message.success('重连成功')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (isManual) {
        message.error(`重连失败: ${errorMsg}`)
      }
      const nextAttempt = (conn.reconnectAttempt || 1) + 1
      const nextDelay = getReconnectDelay(nextAttempt)
      setConnectionReconnecting(connectionId, false, nextAttempt, nextDelay)
    }
  }, [connectedConnections, setConnectionReconnecting, clearConnectionDisconnected, updateSessionShellId, message, getReconnectDelay])

  useEffect(() => {
    const disconnectedConns = connectedConnections.filter(c => c.disconnected && !c.reconnecting)
    
    disconnectedConns.forEach(conn => {
      if (reconnectTimersRef.current[conn.connectionId]) return

      const attempt = conn.reconnectAttempt || 1
      const delay = conn.reconnectNextDelay || getReconnectDelay(attempt)
      
      reconnectTimersRef.current[conn.connectionId] = setTimeout(() => {
        handleReconnect(conn.connectionId, false)
        delete reconnectTimersRef.current[conn.connectionId]
      }, delay)
    })

    const connectedIds = new Set(connectedConnections.filter(c => !c.disconnected).map(c => c.connectionId))
    Object.keys(reconnectTimersRef.current).forEach(id => {
      if (connectedIds.has(id)) {
        clearTimeout(reconnectTimersRef.current[id])
        delete reconnectTimersRef.current[id]
      }
    })

    return () => {
      Object.values(reconnectTimersRef.current).forEach(timer => clearTimeout(timer))
      reconnectTimersRef.current = {}
    }
  }, [connectedConnections, handleReconnect, getReconnectDelay])

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
      const connectionId = conn.connectionId
      const eventName = `connection-disconnected-${connectionId}`
      if (!disconnectListenersRef.current[connectionId]) {
        listen<{ reason: string; shell_id: string }>(eventName, (event) => {
          const currentConn = connectedConnectionsRef.current.find(c => c.connectionId === connectionId)
          if (!currentConn || currentConn.disconnected || disconnectHandledRef.current.has(connectionId)) return
          disconnectHandledRef.current.add(connectionId)
          
          const reason = event.payload.reason as DisconnectReason
          markConnectionDisconnected(connectionId, reason)
          message.warning(`连接 ${currentConn.connection.name} 已断开，按回车键重连`)

          const sessions = getAllSessions(currentConn.rootPane)
          sessions.forEach(s => {
            const key = `${connectionId}_${s.id}`
            const term = terminalInstances.current[key]
            if (term) {
              term.writeln('')
              term.writeln('\x1b[33m[!] 连接已断开，按回车键重连\x1b[0m')
            }
          })
        }).then(unlisten => {
          disconnectListenersRef.current[connectionId] = unlisten
        })
      }
    })

    return () => {
      Object.values(disconnectListenersRef.current).forEach(unlisten => unlisten())
      disconnectListenersRef.current = {}
    }
  }, [connectedConnections, markConnectionDisconnected, message])

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
    const resizeObserver = resizeObserversRef.current[key]
    if (resizeObserver) {
      resizeObserver.disconnect()
    }
    delete resizeObserversRef.current[key]
    delete commandTrackersRef.current[key]
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
      const resizeObserver = resizeObserversRef.current[key]
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      delete resizeObserversRef.current[key]
      initializedRef.current.delete(key)
    }

    await invoke('disconnect_ssh', { id: connId }).catch(() => {})
    closeConnection(connId)
    disconnectHandledRef.current.delete(connId)
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
        term.options.scrollback = terminalSettings.scrollback
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
      const resizeObserver = resizeObserversRef.current[key]
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      delete resizeObserversRef.current[key]
      delete commandTrackersRef.current[key]
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

  const handleQuickConnect = useCallback(async (conn: Connection) => {
    const isConnected = connectedConnections.some(c => c.connectionId === conn.id)
    if (isConnected) {
      setActiveConnection(conn.id)
      return
    }

    message.info(`正在连接 ${conn.name}...`)

    try {
      await invoke('connect_ssh', {
        id: conn.id,
        connection: {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.password || null,
          key_file: conn.keyFile || null,
        }
      })

      const shellId = await invoke<string>('get_shell', { id: conn.id })
      addConnection(conn, shellId)
      await recordConnectionHistory(conn.id)
      await refreshRecentConnections()
      message.success(`已连接到 ${conn.name}`)
    } catch (error) {
      message.error(`连接失败: ${error}`)
    }
  }, [connectedConnections, addConnection, setActiveConnection, message, refreshRecentConnections])

  useEffect(() => {
    if (singleConnectionMode && connectedConnections.length === 0) {
      getCurrentWindow().close()
    }
  }, [singleConnectionMode, connectedConnections.length])

  if (connectedConnections.length === 0) {
    if (singleConnectionMode) {
      return null
    }
    
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--color-bg-container)', gap: 16 }}>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>没有活动的会话</p>
        
        {recentConnections.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400, width: '100%' }}>
            <p style={{ color: 'var(--color-text-quaternary)', fontSize: 12, marginBottom: 4 }}>最近连接</p>
            {recentConnections.map(conn => (
              <Button
                key={conn.id}
                type="text"
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  background: 'var(--color-bg-elevated)',
                  padding: '8px 12px',
                  borderRadius: 6,
                  width: '100%',
                }}
                onClick={() => handleQuickConnect(conn)}
              >
                <span className={getGroupClass(conn.group)} style={{ color: 'var(--group-accent-color, var(--color-text))' }}>
                  {conn.name}
                </span>
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                  {conn.username}@{conn.host}
                </span>
              </Button>
            ))}
          </div>
        )}
        
        <Button 
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/connections')}
          style={{ marginTop: 8 }}
        >
          连接管理
        </Button>
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
              <Panel key={child.id} defaultSize={layout[index]} minSize={20} onResize={() => {
                requestAnimationFrame(() => {
                  Object.values(fitAddons.current).forEach(addon => {
                    try { addon?.fit() } catch {}
                  })
                })
              }}>
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

    const conn = connectedConnections.find(c => c.connectionId === connectionId)

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
        }, 800)
      }}
          isDisconnected={conn?.disconnected}
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
            onContextMenu={(e) => handleContextMenu(e, `${connectionId}_${s.id}`)}
            onClick={() => setActiveSessionInPane(connectionId, pane.id, s.id)}
          />
          <GhostTextOverlay
            sessionKey={`${connectionId}_${s.id}`}
            fontFamily={terminalSettings.fontFamily}
            fontSize={terminalSettings.fontSize}
            themeColors={currentThemeColors}
            ref={(el) => { ghostTextElementsRef.current[`${connectionId}_${s.id}`] = el }}
          />
        </div>
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
        
        {/* 连接断开横幅 */}
        {(() => {
          const conn = connectedConnections.find(c => c.connectionId === connectionId)
          if (!conn?.disconnected) return null
          return (
            <div className="disconnect-banner">
              <span>
                ⚠️ 连接已断开 {conn.reconnecting ? `(重连中... 尝试 ${conn.reconnectAttempt || 1})` : '— 按回车键或点击按钮重连'}
              </span>
              {!conn.reconnecting && (
                <button onClick={() => handleReconnect(connectionId, true)}>
                  立即重连
                </button>
              )}
            </div>
          )
        })()}

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
              const resizeObserver = resizeObserversRef.current[key]
              if (resizeObserver) {
                resizeObserver.disconnect()
              }
              delete resizeObserversRef.current[key]
              delete commandTrackersRef.current[key]
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
          tabBarStyle={{ margin: 0, padding: '0 4px', background: 'var(--color-bg-container)', minHeight: 24, height: 24 }}
          onTabClick={(key) => { if (key === '__add__') handleAddSessionToPane() }}
          destroyInactiveTabPane={false}
          size="small"
        />
      </div>
    )
  }

  const connectionItems = connectedConnections.map(conn => {
    return {
      key: conn.connectionId,
      label: (
        <SortableTab
          id={conn.connectionId}
          connectionName={conn.connection.name}
          label={
            <span className={getGroupClass(conn.connection.group)} style={{ color: conn.disconnected ? 'var(--color-error)' : 'var(--group-accent-color, var(--color-text))', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 2px' }}>
              {conn.disconnected && <DisconnectOutlined style={{ fontSize: 10, flexShrink: 0 }} />}
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{conn.connection.username}@{conn.connection.host}</span>
              {conn.reconnecting && <span style={{ fontSize: 10, opacity: 0.7, flexShrink: 0 }}>重连中...</span>}
              <CloseOutlined
                className="connection-tab-close"
                style={{ marginLeft: 4, fontSize: 10, opacity: 0.5, transition: 'opacity 0.2s', flexShrink: 0, cursor: 'pointer' }}
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

  const handleConnectionDragStart = (event: DragStartEvent) => {
    connectionDragIdRef.current = String(event.active.id)
    setIsConnectionDragging(true)
    setIsDragToNewWindow(false)
  }

  const handleConnectionDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const connectionId = connectionDragIdRef.current
    
    setIsConnectionDragging(false)
    connectionDragIdRef.current = null
    
    if (isDragToNewWindow && connectionId) {
      const conn = connectedConnections.find(c => c.connectionId === connectionId)
      if (conn) {
        try {
          const sessions = getAllSessions(conn.rootPane)
          const sessionsWithShell = sessions.filter(s => s.shellId)
          
          if (sessionsWithShell.length > 0) {
            const connectionData = JSON.stringify({
              connectionId: connectionId,
              connection: conn.connection,
              sessions: sessionsWithShell.map(s => ({
                id: s.id,
                title: s.title,
              })),
              rootPane: conn.rootPane,
            })
            
            await invoke<string>('create_terminal_window', {
              connectionId: connectionId,
              connectionName: conn.connection.name,
              username: conn.connection.username,
              host: conn.connection.host,
              connectionData: connectionData,
            })
            
            for (const s of sessions) {
              const key = `${connectionId}_${s.id}`
              if (unlistenersRef.current[key]) {
                unlistenersRef.current[key]()
                delete unlistenersRef.current[key]
              }
              if (terminalInstances.current[key]) {
                terminalInstances.current[key].dispose()
                delete terminalInstances.current[key]
              }
              delete fitAddons.current[key]
              delete searchAddons.current[key]
              const resizeObserver = resizeObserversRef.current[key]
              if (resizeObserver) {
                resizeObserver.disconnect()
              }
              delete resizeObserversRef.current[key]
              delete commandTrackersRef.current[key]
              initializedRef.current.delete(key)
              if (s.shellId) {
                invoke('close_shell', { id: s.shellId }).catch(() => {})
              }
            }
            
            await invoke('disconnect_ssh', { id: connectionId }).catch(() => {})
            disconnectHandledRef.current.delete(connectionId)
            removeConnectionFromStore(connectionId)
            message.success('已在新窗口中打开')
          } else {
            message.warning('该连接没有活动的终端会话')
          }
        } catch (err) {
          message.error(`创建新窗口失败: ${err}`)
        }
      }
      setIsDragToNewWindow(false)
      return
    }
    
    if (over && active.id !== over.id) {
      const oldIndex = connectedConnections.findIndex(c => c.connectionId === active.id)
      const newIndex = connectedConnections.findIndex(c => c.connectionId === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderConnections(oldIndex, newIndex)
      }
    }
    
    setIsDragToNewWindow(false)
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
        {!singleConnectionMode && (
          <div className="connection-tabs-bar" style={{ 
            display: 'flex', 
            alignItems: 'center',
            background: 'var(--color-bg-elevated)',
            padding: '0 8px',
            gap: 8,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DndContext 
                sensors={sensors} 
                collisionDetection={closestCenter} 
                onDragStart={handleConnectionDragStart}
                onDragEnd={handleConnectionDragEnd}
              >
                <SortableContext items={connectedConnections.map(c => c.connectionId)} strategy={horizontalListSortingStrategy}>
                  <Tabs
                    activeKey={activeConnectionId || undefined}
                    onChange={setActiveConnection}
                    items={connectionItems}
                    style={{ height: 32 }}
                    tabBarStyle={{ margin: 0, padding: '0 4px', background: 'transparent', minHeight: 32 }}
                    size="small"
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
        )}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {connectedConnections.map(conn => (
            <div 
              key={conn.connectionId} 
              style={{ 
                height: '100%', 
                display: (singleConnectionMode || activeConnectionId === conn.connectionId) ? 'flex' : 'none', 
                flexDirection: 'column' 
              }}
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
          <McpLogPanel onClose={() => setApiLogVisible(false)} />
        )}
      </div>

      <RightSidebar
        connectionId={activeConnectionId}
        monitorVisible={monitorVisible}
        fileManagerVisible={activeConnectionId ? !!fileManagerVisible[activeConnectionId] : false}
        apiLogVisible={apiLogVisible}
        mcpEnabled={mcpEnabled}
        isFullscreen={isFullscreen}
        showFullscreen={singleConnectionMode}
        onFullscreenToggle={() => handleToggleFullscreen('')}
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
      
      <DragToNewWindowOverlay visible={!singleConnectionMode && isDragToNewWindow} />

      {historyModalVisible && historyModalKey && (
        <Modal
          open={true}
          onCancel={hideHistoryModal}
          footer={null}
          mask={false}
          title={
            <span>
              <HistoryOutlined style={{ marginRight: 8 }} />
              历史命令
              <Popconfirm
                title="确定清空历史命令？"
                description="此操作不可撤销"
                onConfirm={() => {
                  const [connId] = historyModalKey.split('_')
                  clearConnectionHistory(connId)
                  message.success('已清空历史命令')
                }}
                okText="确定"
                cancelText="取消"
              >
                <Button 
                  type="link" 
                  size="small" 
                  danger
                  style={{ marginLeft: 12 }}
                >
                  清空
                </Button>
              </Popconfirm>
            </span>
          }
          width={500}
          centered
        >
          <Input
            id="history-search-input"
            placeholder="搜索..."
            value={historySearchText}
            onChange={(e) => {
              setHistorySearchText(e.target.value)
              setHistorySelectedIndex(0)
            }}
            prefix={<SearchOutlined />}
            allowClear
            style={{ marginBottom: 12 }}
          />
          <List
            size="small"
            dataSource={(() => {
              const [connId] = historyModalKey.split('_')
              const cache = historyCaches.get(connId) || []
              const filtered = historySearchText
                ? cache.filter(c => c.text.toLowerCase().includes(historySearchText.toLowerCase()))
                : cache
              return filtered.slice(0, 50)
            })()}
            style={{ maxHeight: 250, overflow: 'auto' }}
            renderItem={(item: { text: string; count: number }, index: number) => (
<List.Item
                  onClick={() => selectHistoryCommand(item.text)}
                  onMouseEnter={() => setHistorySelectedIndex(index)}
                  style={{
                    cursor: 'pointer',
                    background: index === historySelectedIndex ? 'var(--color-primary)' : 'transparent',
                    borderRadius: 4,
                    padding: '8px 12px',
                  }}
                >
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: index === historySelectedIndex ? '#fff' : 'var(--color-text)',
                    flex: 1,
                  }}>
                    {item.text}
                  </span>
                </List.Item>
            )}
          />
        </Modal>
      )}

      <ShortcutHelpModal
        visible={shortcutHelpVisible}
        onClose={() => setShortcutHelpVisible(false)}
      />
    </div>
  )
}

export default Terminal
