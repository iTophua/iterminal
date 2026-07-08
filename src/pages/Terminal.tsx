import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { Tabs, App, Button, Tooltip, Input, Modal, List, Popconfirm, Spin } from 'antd'
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
  BulbOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
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
import { useLicenseStore } from '../stores/licenseStore'
import { resolveTerminalTheme } from '../styles/themes/terminal-themes'


import { RightSidebar } from '../components/RightSidebar'
import MonitorPanel from '../components/MonitorPanel'
import FileManagerPanel from '../components/FileManagerPanel'
import McpLogPanel from '../components/McpLogPanel'
import SnippetsPanel from '../components/SnippetsPanel'
import AiAssistantModal from '../components/AiAssistantModal'
import PortForwardPanel from '../components/PortForwardPanel'
import AiChatPanel from '../components/AiChatPanel'
import DockerPanel from '../components/DockerPanel'
import type { TerminalContext } from '../services/ai'
import { STORAGE_KEYS } from '../config/constants'
import { useFullscreen, useContextMenu, useRightPanels } from './terminal/hooks'
import { SortableTab, LeafPane } from './terminal/components'
import { ShortcutHelpModal } from './terminal/components/ShortcutHelpModal'
import { DragToNewWindowOverlay } from './terminal/components/DragToNewWindowOverlay'
import { useConnectionDragToNewWindow } from './terminal/hooks/useConnectionDrag'
import { getAllSessions, getActiveSessionInPane, findPaneBySessionId, hasSplitChildren, getVisibleSessions } from '../utils/paneUtils'
import { getRecentConnections, recordConnectionHistory } from '../services/database'
import { createCommandTracker, CommandTracker } from '../utils/shellOutputParser'
import { matchShortcut } from '../utils/shortcutUtils'
import { applyXtermImePatch } from '../utils/xtermImePatch'
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
  const broadcastEnabled = useTerminalStore(state => state.broadcastEnabled)
  const setActiveConnection = useTerminalStore(state => state.setActiveConnection)
  const isFeatureAvailable = useLicenseStore(state => state.isFeatureAvailable)
  const snippetsEnabled = isFeatureAvailable('snippets')
  const aiEnabled = isFeatureAvailable('ai_assistant')
  const portForwardEnabled = isFeatureAvailable('port_forward')
  const [aiModalVisible, setAiModalVisible] = useState(false)
  const [aiInitialText, setAiInitialText] = useState('')
  // AI 对话面板预填文本（终端右键「发送到 AI 对话」）
  const [aiChatInitialText, setAiChatInitialText] = useState('')
  const closeSession = useTerminalStore(state => state.closeSession)
  const closeConnection = useTerminalStore(state => state.closeConnection)
  const removeConnectionFromStore = useTerminalStore(state => state.removeConnectionFromStore)
  const markConnectionDisconnected = useTerminalStore(state => state.markConnectionDisconnected)
  const clearConnectionDisconnected = useTerminalStore(state => state.clearConnectionDisconnected)
  const setConnectionReconnecting = useTerminalStore(state => state.setConnectionReconnecting)
  const setConnectionInitializing = useTerminalStore(state => state.setConnectionInitializing)
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
  // 终端写入队列状态（enqueueWrite 见下方定义，统一所有 invoke('write_shell') 走 FIFO 队列）
  const writeQueueRef = useRef<{ [key: string]: string }>({})
  const writeDrainingRef = useRef<{ [key: string]: boolean }>({})
  // 用 ref 暴露 enqueueWrite，使定义在 enqueueWrite 之前的回调（如 selectHistoryCommand）也能使用
  const enqueueWriteRef = useRef<(key: string, data: string) => void>(() => {})
  const apiLogVisibleRef = useRef(false)
  const shortcutSettingsRef = useRef(shortcutSettings)
  const terminalSettingsRef = useRef(terminalSettings)
  const connectedConnectionsRef = useRef(connectedConnections)
  // 广播状态 ref：onData 闭包里读取，避免闭包持有旧值
  const broadcastEnabledRef = useRef(broadcastEnabled)
  const currentInputRef = useRef<{ [key: string]: string }>({})
  const ghostTextRef = useRef<{ [key: string]: { input: string, suggestion: string, allSuggestions: string[], currentIndex: number } }>({})
  const ghostTextOverlayRef = useRef<{ [key: string]: { top: number, left: number, text: string } }>({})
  const ghostTextElementsRef = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const ghostTextCellHeightRef = useRef<{ [key: string]: number }>({})
  const ghostTextStartXRef = useRef<{ [key: string]: number }>({})
  const ghostTextLineRef = useRef<{ [key: string]: number }>({})
  // 缓存终端单元格尺寸和偏移，避免每次按键都调用 getBoundingClientRect（触发强制重排）
  const cellMetricsCacheRef = useRef<{ [key: string]: { cellWidth: number; cellHeight: number; offsetX: number; screenOffsetTop: number; cols: number; rows: number } }>({})
  const commandTrackersRef = useRef<{ [key: string]: CommandTracker }>({})
  const initializingTimeoutRef = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({})
  const xtermDomRefs = useRef<{ [key: string]: { screen: HTMLElement | null } }>({})
  // ghost text 按帧合并：快速输入时多次 onData 在同一帧内只算一次 ghost text，
  // 避免每个按键都触发同步 DOM 操作导致主线程阻塞、WKWebView 丢弃按键事件。
  // pendingInputRef 记录最新待处理的 input；rafIdRef 保证一帧只调度一次 rAF。
  const ghostPendingInputRef = useRef<{ [key: string]: { connId: string; input: string } }>({})
  const ghostRafIdRef = useRef<{ [key: string]: number | null }>({})
  const messageRef = useRef(message)
  useEffect(() => { messageRef.current = message }, [message])
  
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

          const domCache = xtermDomRefs.current[key]
          const xtermScreen = domCache?.screen

          if (!xtermScreen) {
            updateGhostTextOverlay(key, 0, 0, '')
            return
          }

          // 使用缓存的单元格尺寸，仅在首次测量或尺寸变化时重新计算
          // 避免每次按键都调用 getBoundingClientRect（强制同步重排）
          const cached = cellMetricsCacheRef.current[key]
          let actualCellWidth: number
          let actualCellHeight: number
          let offsetX: number
          let screenOffsetTop: number

          if (cached && cached.cols === term.cols && cached.rows === term.rows) {
            actualCellWidth = cached.cellWidth
            actualCellHeight = cached.cellHeight
            offsetX = cached.offsetX
            screenOffsetTop = cached.screenOffsetTop
          } else {
            const screenRect = xtermScreen.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()

            const firstRow = xtermScreen.querySelector('.xterm-row')
            if (firstRow) {
              actualCellHeight = (firstRow as HTMLElement).getBoundingClientRect().height
            } else {
              actualCellHeight = screenRect.height / (term.rows || 24)
            }
            actualCellWidth = screenRect.width / (term.cols || 80)
            offsetX = screenRect.left - containerRect.left
            screenOffsetTop = screenRect.top - containerRect.top

            cellMetricsCacheRef.current[key] = {
              cellWidth: actualCellWidth,
              cellHeight: actualCellHeight,
              offsetX,
              screenOffsetTop,
              cols: term.cols,
              rows: term.rows,
            }
          }

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
    delete cellMetricsCacheRef.current[key]
    // 取消待处理的 ghost 更新，避免清空后又被 rAF 回调重新显示
    delete ghostPendingInputRef.current[key]
    const rafId = ghostRafIdRef.current[key]
    if (rafId !== null && rafId !== undefined) {
      cancelAnimationFrame(rafId)
      delete ghostRafIdRef.current[key]
    }
    updateGhostTextOverlay(key, 0, 0, '')
  }, [updateGhostTextOverlay])

  // 按帧合并 ghost text 更新：同一帧内多次调用只保留最新 input，rAF 回调里算一次。
  // 这样快速输入时每帧最多触发一次 matchAndUpdateGhostText（含 DOM 操作），
  // 避免每个按键都同步重排导致 WKWebView 丢弃后续 keydown 事件。
  const scheduleGhostUpdate = useCallback((key: string, connId: string, input: string) => {
    ghostPendingInputRef.current[key] = { connId, input }
    if (ghostRafIdRef.current[key] !== null && ghostRafIdRef.current[key] !== undefined) {
      return // 已有 rAF 待执行，最新 input 已记录，回调会读到
    }
    ghostRafIdRef.current[key] = requestAnimationFrame(() => {
      ghostRafIdRef.current[key] = null
      const pending = ghostPendingInputRef.current[key]
      delete ghostPendingInputRef.current[key]
      if (!pending) return
      matchAndUpdateGhostText(key, pending.connId, pending.input)
    })
  }, [matchAndUpdateGhostText])
  
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

  useEffect(() => {
    broadcastEnabledRef.current = broadcastEnabled
  }, [broadcastEnabled])
  
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
    if (shellIdsRef.current[key]) {
      // 走统一写入队列，保证与随后按键的顺序（避免选历史命令后立刻回车产生乱序）
      enqueueWriteRef.current(key, command)
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
    snippetsVisible,
    setSnippetsVisible,
    portForwardVisible,
    setPortForwardVisible,
    aiChatVisible,
    setAiChatVisible,
    toggleAiChat,
    dockerVisible,
    setDockerVisible,
    toggleDocker,
    toggleMonitor,
    openFileManager,
    toggleApiLog,
    toggleSnippets,
    togglePortForward,
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

  const paneStructureKey = useMemo(() => {
    if (!activeConnection) return ''
    const getKey = (pane: SplitPane): string => {
      if (pane.children && pane.children.length > 0) {
        return `${pane.id}-[${pane.children.map(getKey).join(',')}]`
      }
      return pane.id
    }
    return getKey(activeConnection.rootPane)
  }, [activeConnection?.rootPane])
  
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

  // 终端输入写入队列：保证字符严格 FIFO，避免快速输入时丢字符/乱序。
  // 根因：原来每个按键都 fire-and-forget 一次 invoke('write_shell')，Tauri 对
  // 并发触发的 async 命令不保证 FIFO（各自 tokio::spawn 后由调度器抢占），
  // 快速输入时字符会乱序甚至丢失（表现为命令少一个字母）。
  // 解决：每个 session key 一个缓冲区 + 单条串行 drain 循环，保证严格 FIFO。
  // 附带收益：同一同步执行栈内多次 enqueue（如粘贴/IME/组合键）会合并为一次 invoke。
  const enqueueWrite = useCallback((key: string, data: string) => {
    if (!data) return
    writeQueueRef.current[key] = (writeQueueRef.current[key] || '') + data
    // 已有 drain 在跑就追加等它下一轮处理，避免并发 invoke 竞态
    if (writeDrainingRef.current[key]) return
    writeDrainingRef.current[key] = true

    // 用微任务延迟一拍启动 drain，使同一同步执行栈内的连续 enqueue 合并成一次 invoke
    Promise.resolve().then(async () => {
      try {
        // 串行 drain：上一批写完再写下一批，期间到达的输入累积进队列
        while (true) {
          const shellId = shellIdsRef.current[key]
          // shellId 未就绪（重连中）时不要取走 chunk，等下次 enqueueWrite 再触发写出
          if (!shellId) break
          const chunk = writeQueueRef.current[key]
          if (!chunk) break
          writeQueueRef.current[key] = ''
          try {
            await invoke('write_shell', { id: shellId, data: chunk })
          } catch (err) {
            console.error('写入终端失败:', err)
          }
        }
      } finally {
        writeDrainingRef.current[key] = false
      }
    })
  }, [])

  // 暴露给定义在 enqueueWrite 之前的回调使用（如 selectHistoryCommand）
  useEffect(() => {
    enqueueWriteRef.current = enqueueWrite
  }, [enqueueWrite])

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
      const checkConnectionInitialized = (connId: string) => {
        const conn = connectedConnectionsRef.current.find(c => c.connectionId === connId)
        if (!conn || !conn.initializing) return
        const allSessions = getAllSessions(conn.rootPane)
        const allDone = allSessions.every(s => {
          if (!s.shellId) return true
          return initializedRef.current.has(`${connId}_${s.id}`)
        })
        if (allDone) {
          setConnectionInitializing(connId, false)
        }
      }

      for (const session of sessionsToInit) {
        if (!session.shellId) {
          continue
        }

        const key = `${session.connectionId}_${session.id}`
        const shellId = session.shellId
        const connId = session.connectionId

        if (initializedRef.current.has(key)) {
          // shellId 可能已在重连或恢复时更新，同步到 ref
          if (shellId && shellId !== shellIdsRef.current[key]) {
            shellIdsRef.current[key] = shellId
          }

          const term = terminalInstances.current[key]
          const existingContainer = terminalRefs.current[key]

          if (term && existingContainer && term.element && !existingContainer.contains(term.element)) {
            existingContainer.innerHTML = ''
            existingContainer.appendChild(term.element)
            
            // 恢复 GhostTextOverlay
            const ghostOverlayElement = ghostTextElementsRef.current[key]
            if (ghostOverlayElement) {
              existingContainer.appendChild(ghostOverlayElement)
            }
            
            // 恢复 ResizeObserver
            const existingObserver = resizeObserversRef.current[key]
            if (existingObserver) {
              try { existingObserver.disconnect() } catch {}
              delete resizeObserversRef.current[key]
            }
            let resizeTimer: ReturnType<typeof setTimeout> | null = null
            const resizeObserver = new ResizeObserver(() => {
              if (resizeTimer) clearTimeout(resizeTimer)
              resizeTimer = setTimeout(() => {
                const addon = fitAddons.current[key]
                if (addon) {
                  try { addon.fit() } catch {}
                }
                const ghostEl = ghostTextElementsRef.current[key]
                if (ghostEl) {
                  ghostEl.style.display = 'none'
                  ghostEl.textContent = ''
                }
                delete cellMetricsCacheRef.current[key]
                resizeTimer = null
              }, 100)
            })
            resizeObserver.observe(existingContainer)
            resizeObserversRef.current[key] = resizeObserver
            
            requestAnimationFrame(() => {
              try {
                fitAddons.current[key]?.fit()
                term.refresh(0, term.rows - 1)
                term.focus()
              } catch {}
            })
          }
          checkConnectionInitialized(connId)
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
          // 终端链接检测：URL/IP/路径自动识别，Cmd/Ctrl+点击用系统默认程序打开
          terminal.loadAddon(new WebLinksAddon())
          
          const ghostOverlayElement = ghostTextElementsRef.current[key]
          
          container.innerHTML = ''
          terminal.open(container)

          // 应用 xterm IME keyCode=229 丢字符补丁（必须在 open 后，_core 已初始化）
          applyXtermImePatch(terminal)

          const xtermScreenEl = terminal.element?.querySelector('.xterm-screen') as HTMLElement | null
          if (xtermScreenEl) {
            xtermDomRefs.current[key] = { screen: xtermScreenEl }
          }
          
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

          terminal.attachCustomKeyEventHandler(event => {
            if (event.type !== 'keydown') return true
            
            const settings = shortcutSettingsRef.current
            
            if (matchShortcut(event, settings.splitHorizontal, true)) {
              return false
            }
            if (matchShortcut(event, settings.splitVertical, true)) {
              return false
            }
            if (matchShortcut(event, settings.newSession, true)) {
              return false
            }
            if (matchShortcut(event, settings.closeSession, true)) {
              return false
            }
            if (matchShortcut(event, settings.nextSession, true)) {
              return false
            }
            if (matchShortcut(event, settings.prevSession, true)) {
              return false
            }
            if (matchShortcut(event, settings.fullscreen, true)) {
              return false
            }
            
            if (matchShortcut(event, settings.clearScreen, true)) {
              terminal.clear()
              return false
            }
            
            if (matchShortcut(event, settings.copy, true)) {
              const selection = terminal.getSelection()
              if (selection) {
                writeText(selection).catch(err => {
                  console.error('复制失败:', err)
                })
              }
              return false
            }
            
            if (matchShortcut(event, settings.paste, true)) {
              terminal.clearSelection()
              readText().then(text => {
                if (text) {
                  const currentShellId = shellIdsRef.current[key]
                  if (currentShellId) {
                    // 走统一写入队列，与后续按键保持 FIFO，避免粘贴后立即输入产生乱序
                    enqueueWrite(key, text)
                  }
                }
              }).catch(err => {
                console.error('粘贴失败:', err)
                message.error('粘贴失败')
              })
              return false
            }
            
            if (matchShortcut(event, settings.showHistory, true)) {
              showHistoryModal(key)
              return false
            }
            
            if (matchShortcut(event, settings.nextSuggestion, true)) {
              const ghost = ghostTextRef.current[key]
              if (ghost && ghost.allSuggestions.length > 0) {
                switchSuggestion(key, key.split('_')[0], 'next')
              }
              return false
            }
            
            if (matchShortcut(event, settings.prevSuggestion, true)) {
              const ghost = ghostTextRef.current[key]
              if (ghost && ghost.allSuggestions.length > 0) {
                switchSuggestion(key, key.split('_')[0], 'prev')
              }
              return false
            }

            if (matchShortcut(event, settings.shortcutHelp, true)) {
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
                  enqueueWrite(key, ghost.suggestion)
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
                  scheduleGhostUpdate(key, connId, newInput)
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
              // ⚠️ 异步 + 按帧合并更新 ghost text：matchAndUpdateGhostText 会触发同步 DOM 写入
              // （getBoundingClientRect 强制重排 + style 修改）。若同步执行会阻塞主线程，
              // WKWebView 在高频 keydown 风暴中会合并/丢弃后续按键事件，
              // 表现为快速输入时随机字符丢失（如 grep 的 e、mysql 的 s、docker 的 r）。
              // scheduleGhostUpdate 把 DOM 操作推迟到下一帧，且同一帧多次输入只算一次。
              scheduleGhostUpdate(key, connId, newInput)
            }
            
            enqueueWrite(key, data)

            // 输入广播：开启后把同样输入同步发送到所有其它活跃终端。
            // 只复用 enqueueWrite（纯字符写入），ghost text/命令追踪仅作用于源终端。
            // 只广播到「存在于 connectedConnections 且未断开/重连」的连接，
            // 避免广播到已关闭但 shellIdsRef 残留 key 的死会话。
            if (broadcastEnabledRef.current) {
              for (const otherKey of Object.keys(shellIdsRef.current)) {
                if (otherKey === key) continue
                const [otherConnId] = otherKey.split('_')
                const otherConn = connectedConnectionsRef.current.find(c => c.connectionId === otherConnId)
                // 必须存在且状态正常才广播
                if (!otherConn || otherConn.disconnected || otherConn.reconnecting) continue
                if (!shellIdsRef.current[otherKey]) continue
                enqueueWrite(otherKey, data)
              }
            }
          })

          terminal.onResize(({ cols, rows }) => {
            const currentShellId = shellIdsRef.current[key]
            if (currentShellId) {
              invoke('resize_shell', { id: currentShellId, cols, rows }).catch(err => {
                console.error('调整终端大小失败:', err)
              })
            }
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
          const resizeObserver = new ResizeObserver(() => {
            if (resizeTimer) {
              clearTimeout(resizeTimer)
            }
            resizeTimer = setTimeout(() => {
              const addon = fitAddons.current[key]
              if (addon) {
                try { addon.fit() } catch {}
              }
              clearGhostText(key)
              resizeTimer = null
            }, 100)
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
            messageRef.current.error('启动终端失败，请重试')
          }
        }

        initTerminal().then(() => {
            checkConnectionInitialized(connId)
          }).catch(err => {
            const errorMsg = '终端初始化失败: ' + String(err)
            console.error('[Terminal] initTerminal failed for', key, ':', err)
            messageRef.current.error(errorMsg)
            setConnectionInitializing(connId, false)
          })
      }
    }, 0)

    return () => clearTimeout(timerId)
  }, [connectedConnections.length, activeConnectionId, visibleSessionsKey, paneStructureKey, storeReady, singleConnectionMode, loadHistory])

  // initializing 超时保护：10秒后强制清除
  useEffect(() => {
    for (const conn of connectedConnections) {
      if (conn.initializing && !initializingTimeoutRef.current[conn.connectionId]) {
        initializingTimeoutRef.current[conn.connectionId] = setTimeout(() => {
          console.warn('[Terminal] initializing timeout for', conn.connectionId)
          setConnectionInitializing(conn.connectionId, false)
          delete initializingTimeoutRef.current[conn.connectionId]
        }, 10000)
      }
      if (!conn.initializing && initializingTimeoutRef.current[conn.connectionId]) {
        clearTimeout(initializingTimeoutRef.current[conn.connectionId])
        delete initializingTimeoutRef.current[conn.connectionId]
      }
    }
    const currentIds = new Set(connectedConnections.map(c => c.connectionId))
    for (const id of Object.keys(initializingTimeoutRef.current)) {
      if (!currentIds.has(id)) {
        clearTimeout(initializingTimeoutRef.current[id])
        delete initializingTimeoutRef.current[id]
      }
    }
    return () => {
      for (const id of Object.keys(initializingTimeoutRef.current)) {
        clearTimeout(initializingTimeoutRef.current[id])
      }
    }
  }, [connectedConnections, setConnectionInitializing])

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
      await invoke('disconnect_ssh', { id: connectionId }).catch(() => {})

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
  }, [connectedConnections, setConnectionReconnecting, clearConnectionDisconnected, updateSessionShellId, addCommand, message, getReconnectDelay])

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
    delete xtermDomRefs.current[key]
    // 清理写入队列，避免会话关闭后残留状态
    delete writeQueueRef.current[key]
    delete writeDrainingRef.current[key]
    // 清理 ghost text 待处理状态，避免会话关闭后遗留 rAF 回调
    delete ghostPendingInputRef.current[key]
    const ghostRafId = ghostRafIdRef.current[key]
    if (ghostRafId !== null && ghostRafId !== undefined) {
      cancelAnimationFrame(ghostRafId)
    }
    delete ghostRafIdRef.current[key]
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
            // 走统一写入队列，与后续按键保持 FIFO
            enqueueWriteRef.current(contextMenu.sessionKey, text)
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

  const handleAiAnalyze = useCallback(() => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    const selection = term ? (term.getSelection() || '') : ''
    setAiInitialText(selection)
    setAiModalVisible(true)
    hideContextMenu()
  }, [contextMenu.sessionKey])

  // 终端右键「发送到 AI 对话」：取选中内容填入对话面板输入框
  const handleSendToChat = useCallback(() => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    const selection = term ? (term.getSelection() || '') : ''
    // 每次都更新（即使为空也覆盖），用时间戳前缀强制触发 useEffect
    setAiChatInitialText(selection ? `解释这段终端输出：\n\n${selection}` : '')
    setAiChatVisible(true)
    hideContextMenu()
  }, [contextMenu.sessionKey, setAiChatVisible])

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
      delete xtermDomRefs.current[key]
      // 清理写入队列，避免会话关闭后残留状态
      delete writeQueueRef.current[key]
      delete writeDrainingRef.current[key]
      // 清理 ghost text 待处理状态，避免会话关闭后遗留 rAF 回调
      delete ghostPendingInputRef.current[key]
      const ghostRafId = ghostRafIdRef.current[key]
      if (ghostRafId !== null && ghostRafId !== undefined) {
        cancelAnimationFrame(ghostRafId)
      }
      delete ghostRafIdRef.current[key]
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

  const handleSessionDragStart = useCallback((sessionId: string, connectionId: string, title: string) => {
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current)
    dragTimerRef.current = setTimeout(() => {
      document.body.style.userSelect = 'none'
      dragStartRef.current = { sessionId, connectionId, title }
      draggedSessionRef.current = { sessionId, connectionId, title }
      setDraggedSession({ sessionId, connectionId, title })
    }, 800)
  }, [])

  const handleCloseSplitPane = useCallback(async (connectionId: string, paneId: string, paneSessions: { id: string; shellId?: string }[]) => {
    for (const s of paneSessions) {
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
      delete xtermDomRefs.current[key]
      // 清理写入队列，避免会话关闭后残留状态
      delete writeQueueRef.current[key]
      delete writeDrainingRef.current[key]
      // 清理 ghost text 待处理状态，避免会话关闭后遗留 rAF 回调
      delete ghostPendingInputRef.current[key]
      const ghostRafId = ghostRafIdRef.current[key]
      if (ghostRafId !== null && ghostRafId !== undefined) {
        cancelAnimationFrame(ghostRafId)
      }
      delete ghostRafIdRef.current[key]
      initializedRef.current.delete(key)
    }
    closePane(connectionId, paneId)
  }, [closePane])

  const renderSplitPane = (
    pane: SplitPane,
    connectionId: string
  ): React.ReactNode => {
    if (pane.children && pane.children.length > 0) {
      const layout = pane.sizes || pane.children.map(() => 100 / pane.children!.length)
      const isHorizontal = pane.splitDirection !== 'vertical'
      return (
        <Group
          key={pane.id}
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

    const conn = connectedConnections.find(c => c.connectionId === connectionId)

    return (
      <LeafPane
        pane={pane}
        connectionId={connectionId}
        connection={conn}
        currentThemeColors={currentThemeColors}
        activeSearchSessionKey={activeSearchSessionKey}
        searchText={searchText}
        searchMode={searchMode}
        dropTarget={dropTarget?.connectionId === connectionId ? dropTarget : null}
        terminalRefs={terminalRefs}
        ghostTextElementsRef={ghostTextElementsRef}
        paneRefs={paneRefs}
        searchAddons={searchAddons}
        terminalInstances={terminalInstances}
        onCloseSession={handleCloseSession}
        onReconnect={handleReconnect}
        onContextMenu={handleContextMenu}
        onSetActiveSearchSessionKey={setActiveSearchSessionKey}
        onSetSearchText={setSearchText}
        onSetSearchMode={setSearchMode}
        onSessionDragStart={handleSessionDragStart}
        onCloseSplitPane={handleCloseSplitPane}
      />
    )
  }

  const connectionItems = useMemo(() => connectedConnections.map(conn => ({
    key: conn.connectionId,
    label: (
      <SortableTab
        id={conn.connectionId}
        connectionName={conn.connection.name}
        label={
          <span className={getGroupClass(conn.connection.group)} style={{ color: conn.disconnected ? 'var(--color-error)' : 'var(--group-accent-color, var(--color-text))', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 2px' }}>
            {conn.disconnected && <DisconnectOutlined style={{ fontSize: 10, flexShrink: 0 }} />}
            {conn.initializing && <Spin size="small" style={{ fontSize: 10, flexShrink: 0 }} />}
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
  })), [connectedConnections, handleCloseConnection])

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
            
            // 1. 先清理本地终端状态和 shell
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
              delete xtermDomRefs.current[key]
              // 清理写入队列，避免会话关闭后残留状态
              delete writeQueueRef.current[key]
              delete writeDrainingRef.current[key]
              // 清理 ghost text 待处理状态，避免会话关闭后遗留 rAF 回调
              delete ghostPendingInputRef.current[key]
              const ghostRafId = ghostRafIdRef.current[key]
              if (ghostRafId !== null && ghostRafId !== undefined) {
                cancelAnimationFrame(ghostRafId)
              }
              delete ghostRafIdRef.current[key]
              initializedRef.current.delete(key)
              if (s.shellId) {
                await invoke('close_shell', { id: s.shellId }).catch(() => {})
              }
            }
            
            // 2. 断开 SSH 并从 store 移除，确保新窗口 connect 时 session 已清理
            // 使用 await 确保 disconnect 完成后再创建新窗口，避免竞态
            await invoke('disconnect_ssh', { id: connectionId }).catch(() => {})
            disconnectHandledRef.current.delete(connectionId)
            removeConnectionFromStore(connectionId)

            // 等待一段时间确保后端清理完成（SSH session disconnect 需要时间）
            await new Promise(resolve => setTimeout(resolve, 500))

            // 3. 再创建新窗口
            await invoke<string>('create_terminal_window', {
              connectionId: connectionId,
              connectionName: conn.connection.name,
              username: conn.connection.username,
              host: conn.connection.host,
              connectionData: connectionData,
            })
            
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

  // 切换连接时清理非活动连接的 ResizeObserver，避免内存泄漏
  useEffect(() => {
    if (!activeConnectionId) return
    const activeKeys = new Set<string>()
    const activeConn = connectedConnectionsRef.current.find(c => c.connectionId === activeConnectionId)
    if (activeConn) {
      const sessions = getAllSessions(activeConn.rootPane)
      sessions.forEach(s => activeKeys.add(`${activeConnectionId}_${s.id}`))
    }
    
    Object.keys(resizeObserversRef.current).forEach(key => {
      if (!activeKeys.has(key)) {
        const [connId] = key.split('_')
        if (connId !== activeConnectionId) {
          const observer = resizeObserversRef.current[key]
          if (observer) {
            observer.disconnect()
            delete resizeObserversRef.current[key]
          }
        }
      }
    })
  }, [activeConnectionId])

  const historyModalData = useMemo(() => {
    if (!historyModalKey) return []
    const [connId] = historyModalKey.split('_')
    const cache = historyCaches.get(connId) || []
    const filtered = historySearchText
      ? cache.filter(c => c.text.toLowerCase().includes(historySearchText.toLowerCase()))
      : cache
    return filtered.slice(0, 50)
  }, [historyModalKey, historyCaches, historySearchText])

  return connectedConnections.length === 0 ? (
    singleConnectionMode ? null : (
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
  ) : (
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
          {connectedConnections
            .filter(c => singleConnectionMode || activeConnectionId === c.connectionId)
            .map(conn => (
              <div 
                key={conn.connectionId} 
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                {renderSplitPane(conn.rootPane, conn.connectionId)}
              </div>
            ))}
        </div>
      </div>

      <div style={{
        width: (monitorVisible || (activeConnectionId && fileManagerVisible[activeConnectionId]) || apiLogVisible || snippetsVisible || portForwardVisible || aiChatVisible || dockerVisible) ? 360 : 0,
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.2s ease',
        borderLeft: '1px solid var(--color-border)',
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
        {snippetsVisible && snippetsEnabled && (
          <SnippetsPanel
            onClose={() => setSnippetsVisible(false)}
            onInsert={(cmd) => {
              // 插入到当前活动终端：拼接活动连接+活动 session 的 key
              const conn = connectedConnections.find(c => c.connectionId === activeConnectionId)
              if (!conn || !activeConnectionId) return
              const activeSess = getActiveSessionInPane(conn.rootPane)
              if (!activeSess) return
              const key = `${activeConnectionId}_${activeSess.id}`
              enqueueWrite(key, cmd)
            }}
          />
        )}
        {portForwardVisible && portForwardEnabled && activeConnectionId && (
          <PortForwardPanel
            connectionId={activeConnectionId}
            onClose={() => setPortForwardVisible(false)}
          />
        )}
        {aiChatVisible && aiEnabled && (
          <AiChatPanel
            connectionId={activeConnectionId}
            onClose={() => setAiChatVisible(false)}
            initialText={aiChatInitialText}
            onInsertCommand={(cmd) => {
              const conn = connectedConnections.find(c => c.connectionId === activeConnectionId)
              if (!conn || !activeConnectionId) return
              const activeSess = getActiveSessionInPane(conn.rootPane)
              if (!activeSess) return
              enqueueWrite(`${activeConnectionId}_${activeSess.id}`, cmd)
            }}
            onRunCommand={(cmd) => {
              const conn = connectedConnections.find(c => c.connectionId === activeConnectionId)
              if (!conn || !activeConnectionId) return
              const activeSess = getActiveSessionInPane(conn.rootPane)
              if (!activeSess) return
              enqueueWrite(`${activeConnectionId}_${activeSess.id}`, cmd + '\r')
            }}
            getTerminalContext={() => {
              const conn = connectedConnections.find(c => c.connectionId === activeConnectionId)
              if (!conn || !activeConnectionId) return null
              const activeSess = getActiveSessionInPane(conn.rootPane)
              if (!activeSess) return null
              const key = `${activeConnectionId}_${activeSess.id}`
              const term = terminalInstances.current[key]
              if (!term) return null
              // 最近 200 行输出
              const N = 200
              const buf = term.buffer.active
              const start = Math.max(0, buf.length - N)
              const lines: string[] = []
              for (let i = start; i < buf.length; i++) {
                lines.push(buf.getLine(i)?.translateToString(true) || '')
              }
              const recentOutput = lines.join('\n')
              const selection = term.getSelection() || ''
              const cwd = useTerminalStore.getState().currentPaths[activeConnectionId]
              // 体积控制：整体过大时只保留选中内容，避免 token 爆炸
              const ctx: TerminalContext = {}
              if (selection.trim()) ctx.selection = selection
              const totalSize = recentOutput.length + selection.length
              if (totalSize < 8000 && recentOutput.trim()) ctx.recentOutput = recentOutput
              if (cwd) ctx.cwd = cwd
              return ctx
            }}
          />
        )}
        {dockerVisible && activeConnectionId && (
          <DockerPanel
            connectionId={activeConnectionId}
            onClose={() => setDockerVisible(false)}
            onRunCommand={(cmd) => {
              // 在左侧活动终端执行命令（追加回车自动运行）
              const conn = connectedConnections.find(c => c.connectionId === activeConnectionId)
              if (!conn || !activeConnectionId) return
              const activeSess = getActiveSessionInPane(conn.rootPane)
              if (!activeSess) return
              enqueueWrite(`${activeConnectionId}_${activeSess.id}`, cmd + '\r')
            }}
          />
        )}
      </div>

      <RightSidebar
        connectionId={activeConnectionId}
        monitorVisible={monitorVisible}
        fileManagerVisible={activeConnectionId ? !!fileManagerVisible[activeConnectionId] : false}
        apiLogVisible={apiLogVisible}
        snippetsVisible={snippetsVisible}
        snippetsEnabled={snippetsEnabled}
        portForwardVisible={portForwardVisible}
        portForwardEnabled={portForwardEnabled}
        aiChatVisible={aiChatVisible}
        aiChatEnabled={aiEnabled}
        dockerVisible={dockerVisible}
        mcpEnabled={mcpEnabled}
        isFullscreen={isFullscreen}
        showFullscreen={singleConnectionMode}
        onFullscreenToggle={() => handleToggleFullscreen('')}
        onMonitorToggle={toggleMonitor}
        onFileManagerToggle={openFileManager}
        onApiLogToggle={toggleApiLog}
        onSnippetsToggle={toggleSnippets}
        onPortForwardToggle={togglePortForward}
        onAiChatToggle={toggleAiChat}
        onDockerToggle={toggleDocker}
        />

      {contextMenu.visible && createPortal(
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
          {aiEnabled && (
            <div
              style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={handleAiAnalyze}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <BulbOutlined /> AI 分析{contextMenu.sessionKey && terminalInstances.current[contextMenu.sessionKey]?.hasSelection() ? '选中内容' : ''}
            </div>
          )}
          {aiEnabled && (
            <div
              style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={handleSendToChat}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <MessageOutlined /> 发送到 AI 对话
            </div>
          )}
          <div style={{ height: 1, background: 'var(--color-border)', margin: '3px 0' }} />
          {isContextMenuOnSplitPanel() ? (
            <div
              style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={handleCloseSplitFromContextMenu}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-spotlight)'}
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
        </div>,
        document.body
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

      {aiModalVisible && (
        <AiAssistantModal
          visible={aiModalVisible}
          initialText={aiInitialText}
          onClose={() => setAiModalVisible(false)}
          onInsertCommand={(cmd) => {
            const conn = connectedConnections.find(c => c.connectionId === activeConnectionId)
            if (!conn || !activeConnectionId) return
            const activeSess = getActiveSessionInPane(conn.rootPane)
            if (!activeSess) return
            enqueueWrite(`${activeConnectionId}_${activeSess.id}`, cmd)
          }}
        />
      )}

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
            dataSource={historyModalData}
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
