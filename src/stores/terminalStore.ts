import { create } from 'zustand'

// 连接信息
export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  keyFile?: string
  group: string
  tags: string[]
  status: 'online' | 'offline' | 'connecting'
}

// 布局节点 - 树形结构管理分屏
export interface LayoutNode {
  id: string
  type: 'leaf' | 'split'
  sessionId?: string
  direction?: 'horizontal' | 'vertical'
  children?: LayoutNode[]
  sizes?: number[]
}

export interface Session {
  id: string
  connectionId: string
  shellId: string
  title: string
}

export interface DisconnectedConnection {
  connectionId: string
  connection: Connection
  sessions: Session[]
  lastActiveSessionId: string | null
  disconnectedAt: number
  reason: 'write_failed' | 'channel_closed' | 'server_close' | 'unknown'
}

// 已连接的连接信息（包含多个会话）
export interface ConnectedConnection {
  connectionId: string
  connection: Connection
  sessions: Session[]
  layout: LayoutNode
  activeSessionId: string | null
}

// 传输任务状态
export type TransferStatus = 'pending' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled'

// 传输任务类型
export type TransferType = 'upload' | 'download'

// 传输任务
export interface TransferTask {
  id: string
  connectionId: string
  type: TransferType
  localPath: string
  remotePath: string
  fileName: string
  fileSize: number
  transferred: number
  status: TransferStatus
  paused?: boolean
  error?: string
  startTime: number
  endTime?: number
}

// 文件项
export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: string
  permissions?: string
}

// 终端设置
export interface TerminalSettings {
  fontFamily: string
  fontSize: number  // 10-24
  scrollback: number  // 回滚缓冲区行数 100-100000
  copyOnSelect: boolean  // 选中即复制
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
}

// 默认终端设置
export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontFamily: 'Menlo',
  fontSize: 14,
  scrollback: 10000,
  copyOnSelect: false,
  cursorStyle: 'block',
  cursorBlink: true,
}

export interface ShortcutSettings {
  clearScreen: string
  search: string
  copy: string
  paste: string
  newSession: string
  closeSession: string
  fullscreen: string
  splitHorizontal: string
  splitVertical: string
  nextSession: string
  prevSession: string
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  clearScreen: 'Ctrl+L',
  search: 'Ctrl+F',
  copy: 'Ctrl+Shift+C',
  paste: 'Ctrl+Shift+V',
  newSession: 'Ctrl+Shift+T',
  closeSession: 'Ctrl+Shift+W',
  fullscreen: 'F11',
  splitHorizontal: 'Ctrl+Shift+E',
  splitVertical: 'Ctrl+Shift+O',
  nextSession: 'Ctrl+Tab',
  prevSession: 'Ctrl+Shift+Tab',
}

interface TerminalState {
  connectedConnections: ConnectedConnection[]
  disconnectedConnections: DisconnectedConnection[]
  activeConnectionId: string | null
  // 侧边栏折叠状态
  sidebarCollapsed: boolean
  // 文件管理面板显示状态（按连接ID）
  fileManagerVisible: { [connectionId: string]: boolean }
  // 传输管理面板显示状态（按连接ID）
  transferManagerVisible: { [connectionId: string]: boolean }
  // 传输任务列表（按连接ID）
  transferTasks: { [connectionId: string]: TransferTask[] }
  // 当前文件路径（按连接ID）
  currentPaths: { [connectionId: string]: string }
  // 展开的文件树节点（按连接ID）
  expandedKeys: { [connectionId: string]: string[] }
  // 终端设置
  terminalSettings: TerminalSettings
  // 快捷键设置
  shortcutSettings: ShortcutSettings
  // 设置面板显示状态
  settingsVisible: boolean
  // 可用字体列表（应用启动时预加载）
  availableFonts: string[]
  // 字体加载状态
  fontsLoading: boolean

  // 添加连接
  addConnection: (connection: Connection, shellId: string) => string
  // 添加会话
  addSession: (connectionId: string, shellId: string) => string
  // 关闭会话
  closeSession: (connectionId: string, sessionId: string) => void
  // 关闭连接
  closeConnection: (connectionId: string) => void
  // 设置激活的连接
  setActiveConnection: (connectionId: string | null) => void
  // 设置激活的会话
  setActiveSession: (connectionId: string, sessionId: string) => void
  // 获取当前激活的会话
  getActiveSession: () => Session | null
  // 设置侧边栏折叠状态
  setSidebarCollapsed: (collapsed: boolean) => void
  // 重排连接顺序
  reorderConnections: (oldIndex: number, newIndex: number) => void
  // 重排会话顺序
  reorderSessions: (connectionId: string, oldIndex: number, newIndex: number) => void

  // 分屏终端
  splitSession: (connectionId: string, sessionId: string, direction: 'horizontal' | 'vertical', shellId: string) => string
  closeSplitPanel: (connectionId: string, sessionId: string, panelId: string) => void
  getSessionLayoutNode: (connectionId: string, sessionId: string) => LayoutNode | null
  updateLayoutSizes: (connectionId: string, nodeId: string, sizes: number[]) => void

  // 文件管理面板控制
  setFileManagerVisible: (connectionId: string, visible: boolean) => void
  // 传输管理面板控制
  setTransferManagerVisible: (connectionId: string, visible: boolean) => void
  // 添加传输任务
  addTransferTask: (connectionId: string, task: Omit<TransferTask, 'id' | 'startTime'>) => string
  // 更新传输任务
  updateTransferTask: (connectionId: string, taskId: string, updates: Partial<TransferTask>) => void
  // 移除传输任务
  removeTransferTask: (connectionId: string, taskId: string) => void
  // 清除连接的所有传输任务
  clearTransferTasks: (connectionId: string) => void
  // 设置当前路径
  setCurrentPath: (connectionId: string, path: string) => void
  // 设置展开的文件树节点
  setExpandedKeys: (connectionId: string, keys: string[]) => void
  // 更新终端设置
  updateTerminalSettings: (settings: Partial<TerminalSettings>) => void
  // 更新快捷键设置
  updateShortcutSettings: (settings: Partial<ShortcutSettings>) => void
  // 重置快捷键设置
  resetShortcutSettings: () => void
  // 设置面板显示/隐藏
  setSettingsVisible: (visible: boolean) => void
  // 设置可用字体列表
  setAvailableFonts: (fonts: string[]) => void
  // 设置字体加载状态
  setFontsLoading: (loading: boolean) => void

  markConnectionDisconnected: (connectionId: string, reason: DisconnectedConnection['reason']) => void
  removeDisconnectedConnection: (connectionId: string) => void
  clearAllDisconnectedConnections: () => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  connectedConnections: [],
  disconnectedConnections: [],
  activeConnectionId: null,
  sidebarCollapsed: false,
  fileManagerVisible: {},
  transferManagerVisible: {},
  transferTasks: {},
  currentPaths: {},
  expandedKeys: {},
  terminalSettings: (() => {
    const saved = localStorage.getItem('iterminal_terminal_settings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        const settings = { ...DEFAULT_TERMINAL_SETTINGS, ...parsed }
        if (typeof settings.fontSize === 'number') {
          settings.fontSize = Math.max(10, Math.min(24, settings.fontSize))
        }
        return settings
      } catch {
        return DEFAULT_TERMINAL_SETTINGS
      }
    }
    return DEFAULT_TERMINAL_SETTINGS
  })(),
  shortcutSettings: (() => {
    const saved = localStorage.getItem('iterminal_shortcut_settings')
    if (saved) {
      try {
        return { ...DEFAULT_SHORTCUT_SETTINGS, ...JSON.parse(saved) }
      } catch {
        return DEFAULT_SHORTCUT_SETTINGS
      }
    }
    return DEFAULT_SHORTCUT_SETTINGS
  })(),
  settingsVisible: false,
  availableFonts: [],
  fontsLoading: false,

  addConnection: (connection, shellId) => {
    const sessionId = Date.now().toString()
    const newSession: Session = {
      id: sessionId,
      connectionId: connection.id,
      shellId,
      title: '会话1',
    }
    const layout: LayoutNode = {
      id: sessionId,
      type: 'leaf',
      sessionId,
    }
    set((state) => ({
      connectedConnections: [
        ...state.connectedConnections,
        {
          connectionId: connection.id,
          connection,
          sessions: [newSession],
          layout,
          activeSessionId: sessionId,
        }
      ],
      activeConnectionId: connection.id,
      currentPaths: {
        ...state.currentPaths,
        [connection.id]: '/home/' + connection.username
      }
    }))

    return sessionId
  },

  addSession: (connectionId, shellId) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return ''

    const sessionId = Date.now().toString()
    const sessionCount = conn.sessions.length + 1
    const newSession: Session = {
      id: sessionId,
      connectionId,
      shellId,
      title: `会话${sessionCount}`,
    }
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? {
              ...c,
              sessions: [...c.sessions, newSession],
              activeSessionId: sessionId,
            }
          : c
      ),
    }))

    return sessionId
  },

  closeSession: (connectionId, sessionId) => {
    set((state) => {
      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state

      const newSessions = conn.sessions.filter(s => s.id !== sessionId)

      if (newSessions.length === 0) {
        const newTransferTasks = { ...state.transferTasks }
        delete newTransferTasks[connectionId]
        const newFileManagerVisible = { ...state.fileManagerVisible }
        delete newFileManagerVisible[connectionId]
        const newTransferManagerVisible = { ...state.transferManagerVisible }
        delete newTransferManagerVisible[connectionId]
        const newCurrentPaths = { ...state.currentPaths }
        delete newCurrentPaths[connectionId]
        const newExpandedKeys = { ...state.expandedKeys }
        delete newExpandedKeys[connectionId]

        return {
          connectedConnections: state.connectedConnections.filter(c => c.connectionId !== connectionId),
          activeConnectionId: state.activeConnectionId === connectionId
            ? (state.connectedConnections.length > 1
              ? state.connectedConnections.find(c => c.connectionId !== connectionId)?.connectionId || null
              : null)
            : state.activeConnectionId,
          transferTasks: newTransferTasks,
          fileManagerVisible: newFileManagerVisible,
          transferManagerVisible: newTransferManagerVisible,
          currentPaths: newCurrentPaths,
          expandedKeys: newExpandedKeys,
        }
      }

      const removeFromLayout = (node: LayoutNode): LayoutNode | null => {
        if (node.type === 'leaf') {
          return node.sessionId === sessionId ? null : node
        }
        if (node.children) {
          const newChildren = node.children
            .map(removeFromLayout)
            .filter(Boolean) as LayoutNode[]
          if (newChildren.length === 0) return null
          if (newChildren.length === 1) return newChildren[0]
          return { ...node, children: newChildren }
        }
        return node
      }

      const newLayout = removeFromLayout(conn.layout)
      const newActiveSessionId = conn.activeSessionId === sessionId
        ? (newLayout?.type === 'leaf' ? newLayout.sessionId : newSessions[0]?.id) || null
        : conn.activeSessionId

      return {
        connectedConnections: state.connectedConnections.map(c =>
          c.connectionId === connectionId
            ? { 
                ...c, 
                sessions: newSessions, 
                layout: newLayout || { id: newSessions[0]?.id || '', type: 'leaf', sessionId: newSessions[0]?.id },
                activeSessionId: newActiveSessionId 
              }
            : c
        ),
      }
    })
  },

  closeConnection: (connectionId) => {
    set((state) => {
      const newConnections = state.connectedConnections.filter(c => c.connectionId !== connectionId)
      const newActiveId = state.activeConnectionId === connectionId
        ? (newConnections.length > 0 ? newConnections[0].connectionId : null)
        : state.activeConnectionId

      // 清理连接相关的所有状态
      const newTransferTasks = { ...state.transferTasks }
      delete newTransferTasks[connectionId]
      const newFileManagerVisible = { ...state.fileManagerVisible }
      delete newFileManagerVisible[connectionId]
      const newTransferManagerVisible = { ...state.transferManagerVisible }
      delete newTransferManagerVisible[connectionId]
      const newCurrentPaths = { ...state.currentPaths }
      delete newCurrentPaths[connectionId]
      const newExpandedKeys = { ...state.expandedKeys }
      delete newExpandedKeys[connectionId]

      return {
        connectedConnections: newConnections,
        activeConnectionId: newActiveId,
        transferTasks: newTransferTasks,
        fileManagerVisible: newFileManagerVisible,
        transferManagerVisible: newTransferManagerVisible,
        currentPaths: newCurrentPaths,
        expandedKeys: newExpandedKeys,
      }
    })
  },

  setActiveConnection: (connectionId) => {
    set({ activeConnectionId: connectionId })
  },

  setActiveSession: (connectionId, sessionId) => {
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, activeSessionId: sessionId }
          : c
      ),
      activeConnectionId: connectionId,
    }))
  },

  getActiveSession: () => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === state.activeConnectionId)
    if (!conn || !conn.activeSessionId) return null
    return conn.sessions.find(s => s.id === conn.activeSessionId) || null
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed })
  },

  reorderConnections: (oldIndex: number, newIndex: number) => {
    set((state) => {
      const connections = [...state.connectedConnections]
      if (oldIndex < 0 || oldIndex >= connections.length || newIndex < 0 || newIndex >= connections.length) {
        return state
      }
      const [removed] = connections.splice(oldIndex, 1)
      connections.splice(newIndex, 0, removed)
      return { connectedConnections: connections }
    })
  },

  reorderSessions: (connectionId: string, oldIndex: number, newIndex: number) => {
    set((state) => {
      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state
      const sessions = [...conn.sessions]
      if (oldIndex < 0 || oldIndex >= sessions.length || newIndex < 0 || newIndex >= sessions.length) {
        return state
      }
      const [removed] = sessions.splice(oldIndex, 1)
      sessions.splice(newIndex, 0, removed)
      return {
        connectedConnections: state.connectedConnections.map(c =>
          c.connectionId === connectionId ? { ...c, sessions } : c
        ),
      }
    })
  },

  splitSession: (connectionId: string, sessionId: string, direction: 'horizontal' | 'vertical', shellId: string) => {
    const newSessionId = Date.now().toString()
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return ''

    const sessionCount = conn.sessions.length + 1
    const newSession: Session = {
      id: newSessionId,
      connectionId,
      shellId,
      title: `会话${sessionCount}`,
    }

    const splitLeafInTree = (node: LayoutNode): LayoutNode => {
      if (node.type === 'leaf' && node.sessionId === sessionId) {
        return {
          id: Date.now().toString(),
          type: 'split',
          direction,
          children: [
            { ...node },
            { id: newSessionId, type: 'leaf', sessionId: newSessionId }
          ],
          sizes: [50, 50]
        }
      }
      if (node.children) {
        return { ...node, children: node.children.map(splitLeafInTree) }
      }
      return node
    }

    set((state) => ({
      connectedConnections: state.connectedConnections.map(conn => {
        if (conn.connectionId !== connectionId) return conn
        return {
          ...conn,
          sessions: [...conn.sessions, newSession],
          layout: splitLeafInTree(conn.layout),
          activeSessionId: newSessionId,
        }
      }),
    }))

    return newSessionId
  },

  closeSplitPanel: (connectionId: string, sessionId: string, panelId: string) => {
    set((state) => {
      return {
        connectedConnections: state.connectedConnections.map(conn => {
          if (conn.connectionId !== connectionId) return conn
          const newSessions = conn.sessions.filter(s => s.id !== panelId)
          const removeFromLayout = (node: LayoutNode): LayoutNode | null => {
            if (node.type === 'leaf') {
              return node.sessionId === panelId ? null : node
            }
            if (node.children) {
              const newChildren = node.children
                .map(removeFromLayout)
                .filter(Boolean) as LayoutNode[]
              if (newChildren.length === 0) return null
              if (newChildren.length === 1) return newChildren[0]
              return { ...node, children: newChildren }
            }
            return node
          }
          const newLayout = removeFromLayout(conn.layout)
          return {
            ...conn,
            sessions: newSessions,
            layout: newLayout || conn.layout,
          }
        }),
      }
    })
  },

  getSessionLayoutNode: (connectionId: string, sessionId: string) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return null

    const findNode = (node: LayoutNode): LayoutNode | null => {
      if (node.type === 'leaf' && node.sessionId === sessionId) return node
      if (node.children) {
        for (const child of node.children) {
          const found = findNode(child)
          if (found) return found
        }
      }
      return null
    }
    return findNode(conn.layout)
  },

  updateLayoutSizes: (connectionId: string, nodeId: string, sizes: number[]) => {
    set((state) => {
      const updateSizes = (node: LayoutNode): LayoutNode => {
        if (node.id === nodeId && node.type === 'split') {
          return { ...node, sizes }
        }
        if (node.children) {
          return { ...node, children: node.children.map(updateSizes) }
        }
        return node
      }
      return {
        connectedConnections: state.connectedConnections.map(conn => {
          if (conn.connectionId !== connectionId) return conn
          return { ...conn, layout: updateSizes(conn.layout) }
        }),
      }
    })
  },

  setFileManagerVisible: (connectionId: string, visible: boolean) => {
    set((state) => ({
      fileManagerVisible: {
        ...state.fileManagerVisible,
        [connectionId]: visible
      }
    }))
  },

  setTransferManagerVisible: (connectionId: string, visible: boolean) => {
    set((state) => ({
      transferManagerVisible: {
        ...state.transferManagerVisible,
        [connectionId]: visible
      }
    }))
  },

  addTransferTask: (connectionId: string, task: Omit<TransferTask, 'id' | 'startTime'>) => {
    const taskId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
    const newTask: TransferTask = {
      ...task,
      id: taskId,
      startTime: Date.now(),
    }
    set((state) => ({
      transferTasks: {
        ...state.transferTasks,
        [connectionId]: [...(state.transferTasks[connectionId] || []), newTask]
      }
    }))
    return taskId
  },

  updateTransferTask: (connectionId: string, taskId: string, updates: Partial<TransferTask>) => {
    set((state) => ({
      transferTasks: {
        ...state.transferTasks,
        [connectionId]: state.transferTasks[connectionId]?.map(task =>
          task.id === taskId ? { ...task, ...updates } : task
        ) || []
      }
    }))
  },

  removeTransferTask: (connectionId: string, taskId: string) => {
    set((state) => ({
      transferTasks: {
        ...state.transferTasks,
        [connectionId]: state.transferTasks[connectionId]?.filter(task => task.id !== taskId) || []
      }
    }))
  },

  clearTransferTasks: (connectionId: string) => {
    set((state) => {
      const newTasks = { ...state.transferTasks }
      delete newTasks[connectionId]
      return { transferTasks: newTasks }
    })
  },

  setCurrentPath: (connectionId: string, path: string) => {
    set((state) => ({
      currentPaths: {
        ...state.currentPaths,
        [connectionId]: path
      }
    }))
  },

  setExpandedKeys: (connectionId: string, keys: string[]) => {
    set((state) => ({
      expandedKeys: {
        ...state.expandedKeys,
        [connectionId]: keys
      }
    }))
  },

  updateTerminalSettings: (settings: Partial<TerminalSettings>) => {
    set((state) => {
      const newSettings = { ...state.terminalSettings, ...settings }
      if (typeof newSettings.fontSize === 'number') {
        newSettings.fontSize = Math.max(10, Math.min(24, newSettings.fontSize))
      }
      if (typeof newSettings.scrollback === 'number') {
        newSettings.scrollback = Math.max(100, Math.min(100000, newSettings.scrollback))
      }
      localStorage.setItem('iterminal_terminal_settings', JSON.stringify(newSettings))
      return { terminalSettings: newSettings }
    })
  },

  updateShortcutSettings: (settings: Partial<ShortcutSettings>) => {
    set((state) => {
      const newSettings = { ...state.shortcutSettings, ...settings }
      localStorage.setItem('iterminal_shortcut_settings', JSON.stringify(newSettings))
      return { shortcutSettings: newSettings }
    })
  },

  resetShortcutSettings: () => {
    localStorage.setItem('iterminal_shortcut_settings', JSON.stringify(DEFAULT_SHORTCUT_SETTINGS))
    set({ shortcutSettings: DEFAULT_SHORTCUT_SETTINGS })
  },

  setSettingsVisible: (visible: boolean) => {
    set({ settingsVisible: visible })
  },

  setAvailableFonts: (fonts: string[]) => {
    set({ availableFonts: fonts })
  },

  setFontsLoading: (loading: boolean) => {
    set({ fontsLoading: loading })
  },

  markConnectionDisconnected: (connectionId: string, reason: DisconnectedConnection['reason']) => {
    set((state) => {
      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state

      const disconnected: DisconnectedConnection = {
        connectionId,
        connection: conn.connection,
        sessions: conn.sessions,
        lastActiveSessionId: conn.activeSessionId,
        disconnectedAt: Date.now(),
        reason,
      }

      const newTransferTasks = { ...state.transferTasks }
      delete newTransferTasks[connectionId]
      const newFileManagerVisible = { ...state.fileManagerVisible }
      delete newFileManagerVisible[connectionId]
      const newTransferManagerVisible = { ...state.transferManagerVisible }
      delete newTransferManagerVisible[connectionId]
      const newCurrentPaths = { ...state.currentPaths }
      delete newCurrentPaths[connectionId]
      const newExpandedKeys = { ...state.expandedKeys }
      delete newExpandedKeys[connectionId]

      return {
        connectedConnections: state.connectedConnections.filter(c => c.connectionId !== connectionId),
        disconnectedConnections: [...state.disconnectedConnections.filter(c => c.connectionId !== connectionId), disconnected],
        activeConnectionId: state.activeConnectionId === connectionId
          ? (state.connectedConnections.length > 1
            ? state.connectedConnections.find(c => c.connectionId !== connectionId)?.connectionId || null
            : null)
          : state.activeConnectionId,
        transferTasks: newTransferTasks,
        fileManagerVisible: newFileManagerVisible,
        transferManagerVisible: newTransferManagerVisible,
        currentPaths: newCurrentPaths,
        expandedKeys: newExpandedKeys,
      }
    })
  },

  removeDisconnectedConnection: (connectionId: string) => {
    set((state) => ({
      disconnectedConnections: state.disconnectedConnections.filter(c => c.connectionId !== connectionId),
    }))
  },

  clearAllDisconnectedConnections: () => {
    set({ disconnectedConnections: [] })
  },
}))
