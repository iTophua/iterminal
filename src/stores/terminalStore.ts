import { create } from 'zustand'
import { getRecentConnections } from '../services/database'

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

export interface Session {
  id: string
  connectionId: string
  shellId: string
  title: string
}

export interface SplitPane {
  id: string
  sessions: Session[]
  activeSessionId: string | null
  splitDirection?: 'horizontal' | 'vertical'
  children?: SplitPane[]
  sizes?: number[]
  activePaneId?: string
}

export type DisconnectReason = 'write_failed' | 'channel_closed' | 'server_close' | 'unknown'

// 布局模式：classic 经典（tab+分栏）/ cockpit 驾驶舱（主机墙+浮动窗口）
export type LayoutMode = 'classic' | 'cockpit'

// 驾驶舱主题
export type CockpitThemeName = 'force' | 'aurora' | 'ember'

// 驾驶舱浮动窗口几何信息（key = `${connectionId}_${sessionId}`）
export interface CockpitWindowGeometry {
  x: number
  y: number
  w: number
  h: number
  zoomed?: boolean
  /** 最小化到停靠栏（会话保留，窗口隐藏） */
  minimized?: boolean
  prev?: { x: number; y: number; w: number; h: number }
}

export interface ConnectedConnection {
  connectionId: string
  connection: Connection
  rootPane: SplitPane
  disconnected?: boolean
  disconnectReason?: DisconnectReason
  reconnecting?: boolean
  reconnectAttempt?: number
  reconnectNextDelay?: number
  initializing?: boolean
}

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
  nextSuggestion: string
  prevSuggestion: string
  showHistory: string
  shortcutHelp: string
}

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

export const APP_SHORTCUTS = {
  openSettings: isMac ? 'Cmd+,' : 'Ctrl+,',
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = isMac
  ? {
      clearScreen: 'Cmd+L',
      search: 'Cmd+F',
      copy: 'Cmd+C',
      paste: 'Cmd+V',
      newSession: 'Alt+T',
      closeSession: 'Alt+W',
      fullscreen: 'Alt+Enter',
      splitHorizontal: 'Alt+D',
      splitVertical: 'Alt+Shift+D',
      nextSession: 'Alt+ArrowRight',
      prevSession: 'Alt+ArrowLeft',
      nextSuggestion: 'Alt+ArrowDown',
      prevSuggestion: 'Alt+ArrowUp',
      showHistory: 'Alt+H',
      shortcutHelp: 'Cmd+Shift+K',
    }
  : {
      clearScreen: 'Ctrl+L',
      search: 'Ctrl+F',
      copy: 'Ctrl+Shift+C',
      paste: 'Ctrl+Shift+V',
      newSession: 'Alt+T',
      closeSession: 'Alt+W',
      fullscreen: 'Alt+Enter',
      splitHorizontal: 'Alt+D',
      splitVertical: 'Alt+Shift+D',
      nextSession: 'Alt+ArrowRight',
      prevSession: 'Alt+ArrowLeft',
      nextSuggestion: 'Alt+ArrowDown',
      prevSuggestion: 'Alt+ArrowUp',
      showHistory: 'Alt+H',
      shortcutHelp: 'Ctrl+Shift+K',
    }

export function formatShortcutForDisplay(shortcut: string): string {
  if (!isMac) return shortcut
  return shortcut
    .replace(/Cmd/g, '⌘')
    .replace(/Alt/g, '⌥')
    .replace(/Ctrl/g, '⌃')
    .replace(/Shift/g, '⇧')
}

interface TerminalState {
  connectedConnections: ConnectedConnection[]
  activeConnectionId: string | null
  // 连接分屏：长度 >= 2 且包含当前活动连接时，终端区按此列表同时显示多个连接
  connectionSplitIds: string[]
  // 连接分屏方向：horizontal 左右排 / vertical 上下排
  connectionSplitDirection: 'horizontal' | 'vertical'
  // 布局模式（持久化到 localStorage）
  layoutMode: LayoutMode
  // 驾驶舱主题（持久化）
  cockpitTheme: CockpitThemeName
  // 驾驶舱终端字号（浮动窗口较小，独立于全局终端字号；持久化）
  cockpitFontSize: number
  // 驾驶舱主机墙折叠状态（折叠为图标条；持久化）
  cockpitWallCollapsed: boolean
  // 驾驶舱窗口几何（持久化，会话关闭时自动清理）
  cockpitWindowGeometry: Record<string, CockpitWindowGeometry>
  // 驾驶舱当前聚焦的会话 key（connectionId_sessionId）
  cockpitFocusKey: string | null
  // 所有连接列表（启动时预加载）
  allConnections: Connection[]
  // 最近连接（连接成功后记录，驾驶舱主机墙与经典布局共用）
  recentConnections: Connection[]
  // 拉取最近连接记录（连接成功 / 删除连接后调用）
  refreshRecentConnections: () => Promise<void>
  // 连接列表加载状态
  connectionsLoading: boolean
  // 侧边栏折叠状态
  sidebarCollapsed: boolean
  // 输入广播：开启后，在一个终端的输入会同步发送到所有其它活跃终端
  broadcastEnabled: boolean
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

  // 设置所有连接
  setAllConnections: (connections: Connection[]) => void
  // 设置连接加载状态
  setConnectionsLoading: (loading: boolean) => void
  // 更新单个连接
  updateConnection: (connection: Connection) => void
  // 更新连接状态
  updateConnectionStatus: (id: string, status: Connection['status']) => void
  // 删除连接
  removeConnection: (id: string) => void
  // 添加新连接到列表
  addNewConnection: (connection: Connection) => void
  // 添加连接
  addConnection: (connection: Connection, shellId: string) => string
  // 恢复连接（用于新窗口，包含分屏结构）
  restoreConnection: (connection: Connection, rootPane: SplitPane) => void
  // 更新会话的 shellId（用于新窗口重建 shell）
  updateSessionShellId: (connectionId: string, sessionId: string, shellId: string) => void
  // 添加会话
  addSession: (connectionId: string, shellId: string) => string
  // 关闭会话
  closeSession: (connectionId: string, sessionId: string) => void
  // 关闭连接
  closeConnection: (connectionId: string) => void
  // 移除连接（仅前端状态，不断开后端连接）
  removeConnectionFromStore: (connectionId: string) => void
  // 设置激活的连接
  setActiveConnection: (connectionId: string | null) => void
  // 把连接加入连接分屏视图（第一次加入时会带上当前活动连接）
  addConnectionToSplitView: (connectionId: string, direction?: 'horizontal' | 'vertical') => void
  // 从连接分屏视图中移除某个连接（剩余不足 2 个时自动退出分屏）
  removeConnectionFromSplitView: (connectionId: string) => void
  // 退出连接分屏，恢复单连接视图
  clearConnectionSplitView: () => void
  // 切换布局模式（切到驾驶舱时自动退出连接分屏）
  setLayoutMode: (mode: LayoutMode) => void
  // 切换驾驶舱主题
  setCockpitTheme: (theme: CockpitThemeName) => void
  // 设置驾驶舱终端字号
  setCockpitFontSize: (size: number) => void
  // 切换驾驶舱主机墙折叠
  setCockpitWallCollapsed: (collapsed: boolean) => void
  // 提交窗口几何（拖拽/缩放结束时调用）
  setCockpitWindowGeometry: (key: string, geo: CockpitWindowGeometry) => void
  // 设置驾驶舱聚焦会话
  setCockpitFocusKey: (key: string | null) => void
  // 设置激活的会话
  setActiveSession: (connectionId: string, sessionId: string) => void
  // 获取当前激活的会话
  getActiveSession: () => Session | null
  setSidebarCollapsed: (collapsed: boolean) => void
  // 切换输入广播开关
  toggleBroadcast: () => void
  setBroadcastEnabled: (enabled: boolean) => void
  reorderConnections: (oldIndex: number, newIndex: number) => void

  splitPane: (connectionId: string, paneId: string, direction: 'horizontal' | 'vertical', newPaneId: string, shellId: string) => void
  splitPaneWithPosition: (connectionId: string, paneId: string, direction: 'horizontal' | 'vertical', newPaneId: string, shellId: string, newPosition: 'first' | 'second') => void
  // 移动现有会话到新分屏（拖拽会话 tab 时使用）
  moveSessionToSplitPane: (connectionId: string, sourcePaneId: string, sessionId: string, targetPaneId: string, direction: 'horizontal' | 'vertical', newPosition: 'first' | 'second') => void
  closePane: (connectionId: string, paneId: string) => void
  addSessionToPane: (connectionId: string, paneId: string, shellId: string) => string
  closeSessionInPane: (connectionId: string, paneId: string, sessionId: string) => void
  setActiveSessionInPane: (connectionId: string, paneId: string, sessionId: string) => void
  findPaneBySession: (connectionId: string, sessionId: string) => SplitPane | null
  updatePaneSizes: (connectionId: string, paneId: string, sizes: number[]) => void

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
  // 重新加载字体列表
  reloadFonts: () => Promise<void>

  markConnectionDisconnected: (connectionId: string, reason: DisconnectReason) => void
  clearConnectionDisconnected: (connectionId: string) => void
  setConnectionReconnecting: (connectionId: string, reconnecting: boolean, attempt?: number, nextDelay?: number) => void
  setConnectionInitializing: (connectionId: string, initializing: boolean) => void
}

// ===== 驾驶舱布局持久化（布局模式 / 主题 / 窗口几何） =====
const COCKPIT_STORAGE_KEY = 'iterminal_cockpit'
const COCKPIT_THEMES: CockpitThemeName[] = ['force', 'aurora', 'ember']

function loadCockpitPersist(): {
  layoutMode: LayoutMode
  cockpitTheme: CockpitThemeName
  cockpitFontSize: number
  cockpitWallCollapsed: boolean
  geometry: Record<string, CockpitWindowGeometry>
} | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(COCKPIT_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && (p.layoutMode === 'classic' || p.layoutMode === 'cockpit')) {
      const fontSize = typeof p.cockpitFontSize === 'number' && p.cockpitFontSize >= 10 && p.cockpitFontSize <= 18
        ? p.cockpitFontSize
        : 12
      return {
        layoutMode: p.layoutMode,
        cockpitTheme: COCKPIT_THEMES.includes(p.cockpitTheme) ? p.cockpitTheme : 'force',
        cockpitFontSize: fontSize,
        cockpitWallCollapsed: p.cockpitWallCollapsed === true,
        geometry: p.geometry && typeof p.geometry === 'object' ? p.geometry : {},
      }
    }
  } catch {
  }
  return null
}

function persistCockpit(state: { layoutMode: LayoutMode; cockpitTheme: CockpitThemeName; cockpitFontSize: number; cockpitWallCollapsed: boolean; cockpitWindowGeometry: Record<string, CockpitWindowGeometry> }) {
  try {
    window.localStorage.setItem(COCKPIT_STORAGE_KEY, JSON.stringify({
      layoutMode: state.layoutMode,
      cockpitTheme: state.cockpitTheme,
      cockpitFontSize: state.cockpitFontSize,
      cockpitWallCollapsed: state.cockpitWallCollapsed,
      geometry: state.cockpitWindowGeometry,
    }))
  } catch {
  }
}

const cockpitInitial = loadCockpitPersist()

function collectSessionKeys(pane: SplitPane, prefix: string, out: Set<string>) {
  for (const sess of pane.sessions) out.add(`${prefix}${sess.id}`)
  if (pane.children) for (const child of pane.children) collectSessionKeys(child, prefix, out)
}

// 会话/连接关闭后清理孤儿窗口几何
function pruneCockpitGeometry(
  geometry: Record<string, CockpitWindowGeometry>,
  connections: ConnectedConnection[]
): Record<string, CockpitWindowGeometry> {
  const keep = new Set<string>()
  for (const c of connections) collectSessionKeys(c.rootPane, `${c.connectionId}_`, keep)
  let changed = false
  const out: Record<string, CockpitWindowGeometry> = {}
  for (const key of Object.keys(geometry)) {
    if (keep.has(key)) out[key] = geometry[key]
    else changed = true
  }
  return changed ? out : geometry
}

// 切换活动连接时：目标连接不在连接分屏视图内则退出分屏（恢复单连接视图）
function splitAfterActivate(state: { connectionSplitIds: string[] }, activeId: string | null): string[] {
  const ids = state.connectionSplitIds
  if (ids.length < 2) return ids
  if (activeId && ids.includes(activeId)) return ids
  return []
}

// 移除连接后：从连接分屏视图剔除该连接，剩余不足 2 个时退出分屏
function splitAfterRemove(state: { connectionSplitIds: string[] }, removedId: string): string[] {
  const ids = state.connectionSplitIds
  if (!ids.includes(removedId)) return ids
  const kept = ids.filter(id => id !== removedId)
  return kept.length >= 2 ? kept : []
}

function getNextSessionNumber(pane: SplitPane): number {
  const numbers: number[] = []

  const collectNumbers = (p: SplitPane) => {
    for (const s of p.sessions) {
      const match = s.title.match(/^会话(\d+)$/)
      if (match) {
        numbers.push(parseInt(match[1], 10))
      }
    }
    if (p.children) {
      for (const child of p.children) {
        collectNumbers(child)
      }
    }
  }

  collectNumbers(pane)

  if (numbers.length === 0) return 1
  return Math.max(...numbers) + 1
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  connectedConnections: [],
  activeConnectionId: null,
  connectionSplitIds: [],
  connectionSplitDirection: 'horizontal',
  layoutMode: cockpitInitial?.layoutMode ?? 'classic',
  cockpitTheme: cockpitInitial?.cockpitTheme ?? 'force',
  cockpitFontSize: cockpitInitial?.cockpitFontSize ?? 12,
  cockpitWallCollapsed: cockpitInitial?.cockpitWallCollapsed ?? false,
  cockpitWindowGeometry: cockpitInitial?.geometry ?? {},
  cockpitFocusKey: null,
  allConnections: [],
  connectionsLoading: true,
  sidebarCollapsed: false,
  broadcastEnabled: false,
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
    const savedPlatform = localStorage.getItem('iterminal_shortcut_platform')
    
    if (saved && savedPlatform === (isMac ? 'mac' : 'win')) {
      try {
        return { ...DEFAULT_SHORTCUT_SETTINGS, ...JSON.parse(saved) }
      } catch {
        return DEFAULT_SHORTCUT_SETTINGS
      }
    }
    
    localStorage.setItem('iterminal_shortcut_platform', isMac ? 'mac' : 'win')
    localStorage.setItem('iterminal_shortcut_settings', JSON.stringify(DEFAULT_SHORTCUT_SETTINGS))
    return DEFAULT_SHORTCUT_SETTINGS
  })(),
  settingsVisible: false,
  availableFonts: [],
  fontsLoading: false,

  setAllConnections: (connections) => {
    set({ allConnections: connections, connectionsLoading: false })
  },

  recentConnections: [],

  refreshRecentConnections: async () => {
    try {
      const recent = await getRecentConnections(5)
      set({ recentConnections: recent })
    } catch (error) {
      console.error('[terminalStore] Failed to refresh recent connections:', error)
    }
  },

  setConnectionsLoading: (loading) => {
    set({ connectionsLoading: loading })
  },

  updateConnection: (connection) => {
    set((state) => ({
      allConnections: state.allConnections.map(c =>
        c.id === connection.id ? connection : c
      )
    }))
  },

  updateConnectionStatus: (id: string, status: Connection['status']) => {
    set((state) => ({
      allConnections: state.allConnections.map(c =>
        c.id === id ? { ...c, status } : c
      )
    }))
  },

  removeConnection: (id: string) => {
    set((state) => ({
      allConnections: state.allConnections.filter(c => c.id !== id)
    }))
  },

  addNewConnection: (connection: Connection) => {
    set((state) => ({
      allConnections: [...state.allConnections, connection]
    }))
  },

  addConnection: (connection: Connection, shellId: string) => {
    const sessionId = Date.now().toString()
    const newSession: Session = {
      id: sessionId,
      connectionId: connection.id,
      shellId,
      title: '会话1',
    }
    const rootPane: SplitPane = {
      id: sessionId,
      sessions: [newSession],
      activeSessionId: sessionId,
    }
    set((state) => ({
      connectedConnections: [
        ...state.connectedConnections,
        {
          connectionId: connection.id,
          connection,
          rootPane,
          initializing: true,
        }
      ],
      activeConnectionId: connection.id,
      connectionSplitIds: splitAfterActivate(state, connection.id),
      currentPaths: {
        ...state.currentPaths,
        [connection.id]: '/home/' + connection.username
      }
    }))

    return sessionId
  },

  restoreConnection: (connection, rootPane) => {
    set((state) => ({
      connectedConnections: [
        ...state.connectedConnections,
        {
          connectionId: connection.id,
          connection,
          rootPane,
          initializing: true,
        }
      ],
      activeConnectionId: connection.id,
      connectionSplitIds: splitAfterActivate(state, connection.id),
      currentPaths: {
        ...state.currentPaths,
        [connection.id]: '/home/' + connection.username
      }
    }))
  },

  updateSessionShellId: (connectionId, sessionId, shellId) => {
    const updatePaneShellIds = (pane: SplitPane): SplitPane => {
      return {
        ...pane,
        sessions: pane.sessions.map(s =>
          s.id === sessionId ? { ...s, shellId } : s
        ),
        children: pane.children?.map(updatePaneShellIds),
      }
    }

    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, rootPane: updatePaneShellIds(c.rootPane) }
          : c
      ),
    }))
  },

  addSession: (connectionId, shellId) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return ''

    const sessionId = Date.now().toString()
    const sessionNumber = getNextSessionNumber(conn.rootPane)
    const newSession: Session = {
      id: sessionId,
      connectionId,
      shellId,
      title: `会话${sessionNumber}`,
    }
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? {
              ...c,
              rootPane: {
                ...c.rootPane,
                sessions: [...c.rootPane.sessions, newSession],
                activeSessionId: sessionId,
              }
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

      const newSessions = conn.rootPane.sessions.filter(s => s.id !== sessionId)

      if (newSessions.length === 0) {
        const newConnections = state.connectedConnections.filter(c => c.connectionId !== connectionId)
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
          cockpitWindowGeometry: pruneCockpitGeometry(state.cockpitWindowGeometry, newConnections),
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

      const newActiveSessionId = conn.rootPane.activeSessionId === sessionId
        ? newSessions[0]?.id || null
        : conn.rootPane.activeSessionId

      const newConnections = state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? {
              ...c,
              rootPane: {
                ...c.rootPane,
                sessions: newSessions,
                activeSessionId: newActiveSessionId,
              }
            }
          : c
      )

      return {
        connectedConnections: newConnections,
        cockpitWindowGeometry: pruneCockpitGeometry(state.cockpitWindowGeometry, newConnections),
      }
    })
  },

  closeConnection: (connectionId) => {
    set((state) => {
      const newConnections = state.connectedConnections.filter(c => c.connectionId !== connectionId)
      const afterSplitRemove = splitAfterRemove(state, connectionId)
      let newActiveId = state.activeConnectionId === connectionId
        ? (newConnections.length > 0 ? newConnections[0].connectionId : null)
        : state.activeConnectionId
      // 活动连接被关闭且分屏仍保留 >= 2 个成员时，优先聚焦到剩余分屏成员，
      // 避免兜底的"列表第一个连接"落在分屏外，导致整个分屏视图塌缩
      if (
        state.activeConnectionId === connectionId &&
        afterSplitRemove.length >= 2 &&
        (newActiveId === null || !afterSplitRemove.includes(newActiveId))
      ) {
        newActiveId = afterSplitRemove.find(id => newConnections.some(c => c.connectionId === id)) || newActiveId
      }
      const newSplitIds = splitAfterActivate({ connectionSplitIds: afterSplitRemove }, newActiveId)

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
        connectionSplitIds: newSplitIds,
        cockpitWindowGeometry: pruneCockpitGeometry(state.cockpitWindowGeometry, newConnections),
        transferTasks: newTransferTasks,
        fileManagerVisible: newFileManagerVisible,
        transferManagerVisible: newTransferManagerVisible,
        currentPaths: newCurrentPaths,
        expandedKeys: newExpandedKeys,
      }
    })
  },

  removeConnectionFromStore: (connectionId) => {
    set((state) => {
      const newConnections = state.connectedConnections.filter(c => c.connectionId !== connectionId)
      const afterSplitRemove = splitAfterRemove(state, connectionId)
      let newActiveId = state.activeConnectionId === connectionId
        ? (newConnections.length > 0 ? newConnections[0].connectionId : null)
        : state.activeConnectionId
      // 活动连接被关闭且分屏仍保留 >= 2 个成员时，优先聚焦到剩余分屏成员，
      // 避免兜底的"列表第一个连接"落在分屏外，导致整个分屏视图塌缩
      if (
        state.activeConnectionId === connectionId &&
        afterSplitRemove.length >= 2 &&
        (newActiveId === null || !afterSplitRemove.includes(newActiveId))
      ) {
        newActiveId = afterSplitRemove.find(id => newConnections.some(c => c.connectionId === id)) || newActiveId
      }
      const newSplitIds = splitAfterActivate({ connectionSplitIds: afterSplitRemove }, newActiveId)

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
        connectionSplitIds: newSplitIds,
        cockpitWindowGeometry: pruneCockpitGeometry(state.cockpitWindowGeometry, newConnections),
        transferTasks: newTransferTasks,
        fileManagerVisible: newFileManagerVisible,
        transferManagerVisible: newTransferManagerVisible,
        currentPaths: newCurrentPaths,
        expandedKeys: newExpandedKeys,
      }
    })
  },

  setActiveConnection: (connectionId) => {
    set((state) => ({
      activeConnectionId: connectionId,
      connectionSplitIds: splitAfterActivate(state, connectionId),
    }))
  },

  addConnectionToSplitView: (connectionId, direction) => {
    set((state) => {
      // 先剔除已不存在的连接，防御历史残留
      const ids = state.connectionSplitIds.filter(id =>
        state.connectedConnections.some(c => c.connectionId === id)
      )
      let newIds = ids
      if (ids.length === 0) {
        // 第一次进入分屏：当前活动连接 + 目标连接一起进分屏
        const base = state.activeConnectionId && state.activeConnectionId !== connectionId
          ? [state.activeConnectionId]
          : []
        newIds = [...base, connectionId]
      } else if (!ids.includes(connectionId)) {
        newIds = [...ids, connectionId]
      }
      return {
        connectionSplitIds: newIds,
        connectionSplitDirection: direction || state.connectionSplitDirection,
        activeConnectionId: connectionId,
      }
    })
  },

  removeConnectionFromSplitView: (connectionId) => {
    set((state) => {
      const kept = state.connectionSplitIds.filter(id => id !== connectionId)
      // 剩不足 2 个时退出分屏，恢复单连接视图
      if (kept.length >= 2) {
        return {
          connectionSplitIds: kept,
          // 被移除的若是活动连接，聚焦到剩余第一个；
          // 否则活动连接落在分屏外会导致视图退回单连接
          activeConnectionId: state.activeConnectionId === connectionId
            ? kept[0]
            : state.activeConnectionId,
        }
      }
      if (kept.length === 1) {
        return { connectionSplitIds: [], activeConnectionId: kept[0] }
      }
      return { connectionSplitIds: [] }
    })
  },

  clearConnectionSplitView: () => {
    set({ connectionSplitIds: [] })
  },

  setLayoutMode: (mode) => {
    // 连接分屏状态在驾驶舱期间保留（closeConnection 等路径会自然剔除失效成员），
    // 切回经典时若活动连接仍在分屏内则自动恢复分屏视图
    set({ layoutMode: mode })
    persistCockpit(get())
  },

  setCockpitTheme: (theme) => {
    set({ cockpitTheme: theme })
    persistCockpit(get())
  },

  setCockpitFontSize: (size) => {
    const clamped = Math.max(10, Math.min(18, Math.round(size)))
    set({ cockpitFontSize: clamped })
    persistCockpit(get())
  },

  setCockpitWallCollapsed: (collapsed) => {
    set({ cockpitWallCollapsed: collapsed })
    persistCockpit(get())
  },

  setCockpitWindowGeometry: (key, geo) => {
    set((state) => ({ cockpitWindowGeometry: { ...state.cockpitWindowGeometry, [key]: geo } }))
    persistCockpit(get())
  },

  setCockpitFocusKey: (key) => {
    set({ cockpitFocusKey: key })
  },

  setActiveSession: (connectionId, sessionId) => {
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, rootPane: { ...c.rootPane, activeSessionId: sessionId } }
          : c
      ),
      activeConnectionId: connectionId,
      connectionSplitIds: splitAfterActivate(state, connectionId),
    }))
  },

  getActiveSession: () => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === state.activeConnectionId)
    if (!conn) return null
    
    const findActiveInPane = (pane: SplitPane): Session | null => {
      if (pane.children) {
        for (const child of pane.children) {
          const found = findActiveInPane(child)
          if (found) return found
        }
        return null
      }
      if (pane.activeSessionId) {
        return pane.sessions.find(s => s.id === pane.activeSessionId) || null
      }
      return pane.sessions[0] || null
    }
    
    return findActiveInPane(conn.rootPane)
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed })
  },

  toggleBroadcast: () => {
    set((state) => ({ broadcastEnabled: !state.broadcastEnabled }))
  },

  setBroadcastEnabled: (enabled: boolean) => {
    set({ broadcastEnabled: enabled })
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

  splitPane: (connectionId, paneId, direction, newPaneId, shellId) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return

    const sessionNumber = getNextSessionNumber(conn.rootPane)
    const newSession: Session = {
      id: newPaneId,
      connectionId,
      shellId,
      title: `会话${sessionNumber}`,
    }

    const newChildPane: SplitPane = {
      id: newPaneId,
      sessions: [newSession],
      activeSessionId: newPaneId,
    }

    const updatePane = (pane: SplitPane): SplitPane => {
      if (pane.id === paneId) {
        return {
          id: `split-${Date.now()}`,
          sessions: [],
          activeSessionId: null,
          splitDirection: direction,
          children: [pane, newChildPane],
          sizes: [50, 50],
        }
      }
      if (pane.children) {
        return { ...pane, children: pane.children.map(updatePane) }
      }
      return pane
    }

    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, rootPane: updatePane(c.rootPane) }
          : c
      ),
    }))
  },

  splitPaneWithPosition: (connectionId, paneId, direction, newPaneId, shellId, newPosition) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return

    const sessionNumber = getNextSessionNumber(conn.rootPane)
    const newSession: Session = {
      id: newPaneId,
      connectionId,
      shellId,
      title: `会话${sessionNumber}`,
    }

    const newChildPane: SplitPane = {
      id: newPaneId,
      sessions: [newSession],
      activeSessionId: newPaneId,
    }

    const updatePane = (pane: SplitPane): SplitPane => {
      if (pane.id === paneId) {
        const children = newPosition === 'first' 
          ? [newChildPane, pane] 
          : [pane, newChildPane]
        return {
          id: `split-${Date.now()}`,
          sessions: [],
          activeSessionId: null,
          splitDirection: direction,
          children,
          sizes: [50, 50],
        }
      }
      if (pane.children) {
        return { ...pane, children: pane.children.map(updatePane) }
      }
      return pane
    }

    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, rootPane: updatePane(c.rootPane) }
          : c
      ),
    }))
  },

  moveSessionToSplitPane: (connectionId, sourcePaneId, sessionId, targetPaneId, direction, newPosition) => {
    set((state) => {
      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state

      let movedSession: Session | null = null
      const findSession = (pane: SplitPane): Session | null => {
        const sess = pane.sessions.find(s => s.id === sessionId)
        if (sess) return sess
        if (pane.children) {
          for (const child of pane.children) {
            const found = findSession(child)
            if (found) return found
          }
        }
        return null
      }
      movedSession = findSession(conn.rootPane)
      if (!movedSession) return state

      if (sourcePaneId === targetPaneId) {
        const baseTime = Date.now()
        const newChildPaneId = `pane-${baseTime}`
        const newSplitId = `split-${baseTime + 1}`
        const remainingPaneId = `pane-${baseTime + 2}`
        
        const handleSamePaneSplit = (pane: SplitPane): SplitPane => {
          if (pane.id === targetPaneId) {
            const remainingSessions = pane.sessions.filter(s => s.id !== sessionId)
            
            if (remainingSessions.length === 0) return pane
            
            const movedPane: SplitPane = {
              id: newChildPaneId,
              sessions: [movedSession!],
              activeSessionId: sessionId,
            }
            
            const remainingPane: SplitPane = {
              id: remainingPaneId,
              sessions: remainingSessions,
              activeSessionId: remainingSessions[0]?.id || null,
            }
            
            const children = newPosition === 'first'
              ? [movedPane, remainingPane]
              : [remainingPane, movedPane]
            
            return {
              id: newSplitId,
              sessions: [],
              activeSessionId: null,
              splitDirection: direction,
              children,
              sizes: [50, 50],
            }
          }
          if (pane.children) {
            return { ...pane, children: pane.children.map(handleSamePaneSplit) }
          }
          return pane
        }
        
        const newRootPane = handleSamePaneSplit(conn.rootPane)
        
        return {
          connectedConnections: state.connectedConnections.map(c =>
            c.connectionId === connectionId
              ? { ...c, rootPane: newRootPane }
              : c
          ),
        }
      }

      // 一般情况：先移除会话，再在目标位置创建分屏
      const baseTime = Date.now()
      let idCounter = 0
      const nextId = () => {
        idCounter++
        return `${baseTime + idCounter}`
      }

      const removeSessionFromPane = (pane: SplitPane): SplitPane | null => {
        if (pane.id === sourcePaneId) {
          const newSessions = pane.sessions.filter(s => s.id !== sessionId)
          if (newSessions.length === 0) {
            return null
          }
          const newActiveSessionId = pane.activeSessionId === sessionId
            ? newSessions[0]?.id || null
            : pane.activeSessionId
          return { ...pane, sessions: newSessions, activeSessionId: newActiveSessionId }
        }
        if (pane.children) {
          const newChildren = pane.children.map(removeSessionFromPane).filter(Boolean) as SplitPane[]
          if (newChildren.length === 0) return null
          if (newChildren.length === 1) {
            const singleChild = newChildren[0]
            return {
              id: `pane-${nextId()}`,
              sessions: singleChild.sessions,
              activeSessionId: singleChild.activeSessionId,
              splitDirection: undefined,
              children: undefined,
              sizes: undefined,
            }
          }
          const newSizes = newChildren.map(() => 100 / newChildren.length)
          return { ...pane, children: newChildren, sizes: newSizes }
        }
        return pane
      }

      const createSplitWithSession = (pane: SplitPane): SplitPane => {
        if (pane.id === targetPaneId) {
          const newChildPane: SplitPane = {
            id: `pane-${nextId()}`,
            sessions: [movedSession!],
            activeSessionId: sessionId,
          }
          const children = newPosition === 'first'
            ? [newChildPane, pane]
            : [pane, newChildPane]
          return {
            id: `split-${nextId()}`,
            sessions: [],
            activeSessionId: null,
            splitDirection: direction,
            children,
            sizes: [50, 50],
          }
        }
        if (pane.children) {
          return { ...pane, children: pane.children.map(createSplitWithSession) }
        }
        return pane
      }

      let newRootPane = removeSessionFromPane(conn.rootPane)
      if (!newRootPane) {
        return state
      }

      newRootPane = createSplitWithSession(newRootPane)

      return {
        connectedConnections: state.connectedConnections.map(c =>
          c.connectionId === connectionId
            ? { ...c, rootPane: newRootPane }
            : c
        ),
      }
    })
  },

  closePane: (connectionId, paneId) => {
    set((state) => {
      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state

      const removePane = (pane: SplitPane): SplitPane | null => {
        if (pane.id === paneId) return null
        if (pane.children) {
          const newChildren = pane.children.map(removePane).filter(Boolean) as SplitPane[]
          if (newChildren.length === 0) return null
          if (newChildren.length === 1) {
            const singleChild = newChildren[0]
            return {
              id: `pane-${Date.now()}`,
              sessions: singleChild.sessions,
              activeSessionId: singleChild.activeSessionId,
              splitDirection: undefined,
              children: undefined,
              sizes: undefined,
            }
          }
          const newSizes = newChildren.map(() => 100 / newChildren.length)
          return { ...pane, children: newChildren, sizes: newSizes }
        }
        return pane
      }

      const newRootPane = removePane(conn.rootPane)
      if (!newRootPane) return state

      const newConnections = state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, rootPane: newRootPane }
          : c
      )
      return {
        connectedConnections: newConnections,
        cockpitWindowGeometry: pruneCockpitGeometry(state.cockpitWindowGeometry, newConnections),
      }
    })
  },

  addSessionToPane: (connectionId, paneId, shellId) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return ''

    const sessionId = Date.now().toString()
    const sessionNumber = getNextSessionNumber(conn.rootPane)
    const newSession: Session = {
      id: sessionId,
      connectionId,
      shellId,
      title: `会话${sessionNumber}`,
    }

    const updatePane = (pane: SplitPane): SplitPane => {
      if (pane.id === paneId) {
        return {
          ...pane,
          sessions: [...pane.sessions, newSession],
          activeSessionId: sessionId,
        }
      }
      if (pane.children) {
        return { ...pane, children: pane.children.map(updatePane) }
      }
      return pane
    }

    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, rootPane: updatePane(c.rootPane) }
          : c
      ),
    }))

    return sessionId
  },

  closeSessionInPane: (connectionId, paneId, sessionId) => {
    set((state) => {
      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state

      const updatePane = (pane: SplitPane): SplitPane => {
        if (pane.id === paneId) {
          const newSessions = pane.sessions.filter(s => s.id !== sessionId)
          const newActiveSessionId = pane.activeSessionId === sessionId
            ? newSessions[0]?.id || null
            : pane.activeSessionId
          return {
            ...pane,
            sessions: newSessions,
            activeSessionId: newActiveSessionId,
          }
        }
        if (pane.children) {
          return { ...pane, children: pane.children.map(updatePane) }
        }
        return pane
      }

      const newConnections = state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, rootPane: updatePane(c.rootPane) }
          : c
      )
      return {
        connectedConnections: newConnections,
        cockpitWindowGeometry: pruneCockpitGeometry(state.cockpitWindowGeometry, newConnections),
      }
    })
  },

  setActiveSessionInPane: (connectionId, paneId, sessionId) => {
    set((state) => {
      const updatePane = (pane: SplitPane): SplitPane => {
        if (pane.id === paneId) {
          return { ...pane, activeSessionId: sessionId }
        }
        if (pane.children) {
          return { ...pane, children: pane.children.map(updatePane) }
        }
        return pane
      }

      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state

      const hasChildren = conn.rootPane.children && conn.rootPane.children.length > 0

      const newRootPane = updatePane(conn.rootPane)
      
      return {
        connectedConnections: state.connectedConnections.map(c =>
          c.connectionId === connectionId
            ? {
                ...c,
                rootPane: hasChildren
                  ? { ...newRootPane, activePaneId: paneId }
                  : newRootPane
              }
            : c
        ),
        // 连接分屏下点击某面板的终端/会话时，把该连接设为活动连接
        activeConnectionId: connectionId,
        connectionSplitIds: splitAfterActivate(state, connectionId),
      }
    })
  },

  findPaneBySession: (connectionId, sessionId) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return null

    const findPane = (pane: SplitPane): SplitPane | null => {
      if (pane.sessions.some(s => s.id === sessionId)) return pane
      if (pane.children) {
        for (const child of pane.children) {
          const found = findPane(child)
          if (found) return found
        }
      }
      return null
    }

    return findPane(conn.rootPane)
  },

  updatePaneSizes: (connectionId, paneId, sizes) => {
    set((state) => {
      const updatePane = (pane: SplitPane): SplitPane => {
        if (pane.id === paneId && pane.children) {
          return { ...pane, sizes }
        }
        if (pane.children) {
          return { ...pane, children: pane.children.map(updatePane) }
        }
        return pane
      }

      return {
        connectedConnections: state.connectedConnections.map(c =>
          c.connectionId === connectionId
            ? { ...c, rootPane: updatePane(c.rootPane) }
            : c
        ),
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
    const taskId = Date.now().toString() + Math.random().toString(36).slice(2, 11)
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
    localStorage.setItem('iterminal_shortcut_platform', isMac ? 'mac' : 'win')
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

  reloadFonts: async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    set({ fontsLoading: true })
    try {
      const fonts = await invoke<string[]>('get_monospace_fonts')
      if (fonts.length > 0) {
        set({ availableFonts: fonts })
        localStorage.setItem('iterminal_cached_fonts', JSON.stringify(fonts))
      }
    } catch (error) {
      console.error('Failed to reload fonts:', error)
    } finally {
      set({ fontsLoading: false })
    }
  },

  markConnectionDisconnected: (connectionId: string, reason: DisconnectReason) => {
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, disconnected: true, disconnectReason: reason, reconnecting: false, initializing: false }
          : c
      ),
    }))
  },

  clearConnectionDisconnected: (connectionId: string) => {
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, disconnected: false, disconnectReason: undefined, reconnecting: false, reconnectAttempt: undefined, reconnectNextDelay: undefined, initializing: false }
          : c
      ),
    }))
  },

  setConnectionReconnecting: (connectionId: string, reconnecting: boolean, attempt?: number, nextDelay?: number) => {
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, reconnecting, reconnectAttempt: attempt, reconnectNextDelay: nextDelay }
          : c
      ),
    }))
  },

  setConnectionInitializing: (connectionId: string, initializing: boolean) => {
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, initializing }
          : c
      ),
    }))
  },
}))
