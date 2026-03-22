import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useTerminalStore, Connection, DEFAULT_TERMINAL_SETTINGS, SplitPane } from '../terminalStore'

const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage })

function countSessionsInPane(pane: SplitPane): number {
  if (pane.children) {
    return pane.children.reduce((sum, child) => sum + countSessionsInPane(child), 0)
  }
  return pane.sessions.length
}

describe('terminalStore', () => {
  const mockConnection: Connection = {
    id: 'conn-1',
    name: 'Test Server',
    host: '192.168.1.1',
    port: 22,
    username: 'root',
    password: 'secret',
    group: 'Production',
    tags: ['tag1'],
    status: 'offline',
  }

  beforeEach(() => {
    mockLocalStorage.clear()
    vi.clearAllMocks()
    useTerminalStore.setState({
      connectedConnections: [],
      activeConnectionId: null,
      sidebarCollapsed: false,
      fileManagerVisible: {},
      transferManagerVisible: {},
      transferTasks: {},
      currentPaths: {},
      expandedKeys: {},
      terminalSettings: DEFAULT_TERMINAL_SETTINGS,
      settingsVisible: false,
      availableFonts: [],
      fontsLoading: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('addConnection', () => {
    it('should add a new connection with initial session', () => {
      const sessionId = useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      const state = useTerminalStore.getState()
      expect(state.connectedConnections).toHaveLength(1)
      expect(state.connectedConnections[0].connectionId).toBe('conn-1')
      expect(state.connectedConnections[0].rootPane.sessions).toHaveLength(1)
      expect(state.connectedConnections[0].rootPane.sessions[0].shellId).toBe('shell-1')
      expect(state.activeConnectionId).toBe('conn-1')
      expect(sessionId).toBeTruthy()
    })

    it('should set default path based on username', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      const state = useTerminalStore.getState()
      expect(state.currentPaths['conn-1']).toBe('/home/root')
    })
  })

  describe('addSession', () => {
    it('should add a new session to existing connection', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      const sessionId = useTerminalStore.getState().addSession('conn-1', 'shell-2')
      
      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.sessions).toHaveLength(2)
      expect(conn?.rootPane.activeSessionId).toBe(sessionId)
    })

    it('should return empty string if connection not found', () => {
      const sessionId = useTerminalStore.getState().addSession('non-existent', 'shell-1')
      expect(sessionId).toBe('')
    })
  })

  describe('closeSession', () => {
    it('should remove session from connection', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      const stateBeforeAdd = useTerminalStore.getState()
      const firstSessionId = stateBeforeAdd.connectedConnections[0].rootPane.sessions[0].id
      
      vi.useFakeTimers()
      vi.advanceTimersByTime(100)
      const sessionId = useTerminalStore.getState().addSession('conn-1', 'shell-2')
      vi.useRealTimers()
      
      useTerminalStore.getState().closeSession('conn-1', sessionId)
      
      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.sessions).toHaveLength(1)
      expect(conn?.rootPane.sessions[0].id).toBe(firstSessionId)
    })

    it('should remove entire connection when last session is closed', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].rootPane.sessions[0].id
      
      useTerminalStore.getState().closeSession('conn-1', sessionId)
      
      const state = useTerminalStore.getState()
      expect(state.connectedConnections).toHaveLength(0)
      expect(state.activeConnectionId).toBe(null)
    })

    it('should clean up related state when connection is removed', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      useTerminalStore.getState().setFileManagerVisible('conn-1', true)
      useTerminalStore.getState().setCurrentPath('conn-1', '/custom/path')
      
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].rootPane.sessions[0].id
      useTerminalStore.getState().closeSession('conn-1', sessionId)
      
      const state = useTerminalStore.getState()
      expect(state.fileManagerVisible['conn-1']).toBeUndefined()
      expect(state.currentPaths['conn-1']).toBeUndefined()
    })
  })

  describe('closeConnection', () => {
    it('should remove connection and all related state', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      useTerminalStore.getState().setFileManagerVisible('conn-1', true)
      useTerminalStore.getState().setTransferManagerVisible('conn-1', true)
      
      useTerminalStore.getState().closeConnection('conn-1')
      
      const state = useTerminalStore.getState()
      expect(state.connectedConnections).toHaveLength(0)
      expect(state.activeConnectionId).toBe(null)
      expect(state.fileManagerVisible['conn-1']).toBeUndefined()
      expect(state.transferManagerVisible['conn-1']).toBeUndefined()
    })

    it('should switch active connection to another when closing current', () => {
      const conn2: Connection = { ...mockConnection, id: 'conn-2', name: 'Server 2' }
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      useTerminalStore.getState().addConnection(conn2, 'shell-2')
      
      useTerminalStore.getState().closeConnection('conn-1')
      
      const state = useTerminalStore.getState()
      expect(state.connectedConnections).toHaveLength(1)
      expect(state.activeConnectionId).toBe('conn-2')
    })
  })

  describe('setActiveConnection/setActiveSession', () => {
    it('should set active connection', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      useTerminalStore.getState().setActiveConnection('conn-1')
      
      expect(useTerminalStore.getState().activeConnectionId).toBe('conn-1')
    })

    it('should set active session and update connection', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const sessionId = useTerminalStore.getState().addSession('conn-1', 'shell-2')
      
      useTerminalStore.getState().setActiveSession('conn-1', sessionId)
      
      const state = useTerminalStore.getState()
      expect(state.activeConnectionId).toBe('conn-1')
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.activeSessionId).toBe(sessionId)
    })
  })

  describe('getActiveSession', () => {
    it('should return active session', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      const session = useTerminalStore.getState().getActiveSession()
      
      expect(session).not.toBeNull()
      expect(session?.shellId).toBe('shell-1')
    })

    it('should return null when no active connection', () => {
      const session = useTerminalStore.getState().getActiveSession()
      expect(session).toBeNull()
    })
  })

  describe('reorderConnections', () => {
    it('should reorder connections', () => {
      const conn2: Connection = { ...mockConnection, id: 'conn-2' }
      const conn3: Connection = { ...mockConnection, id: 'conn-3' }
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      useTerminalStore.getState().addConnection(conn2, 'shell-2')
      useTerminalStore.getState().addConnection(conn3, 'shell-3')
      
      useTerminalStore.getState().reorderConnections(0, 2)
      
      const state = useTerminalStore.getState()
      expect(state.connectedConnections[0].connectionId).toBe('conn-2')
      expect(state.connectedConnections[1].connectionId).toBe('conn-3')
      expect(state.connectedConnections[2].connectionId).toBe('conn-1')
    })

    it('should handle invalid indices', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      useTerminalStore.getState().reorderConnections(-1, 0)
      useTerminalStore.getState().reorderConnections(0, 100)
      
      expect(useTerminalStore.getState().connectedConnections).toHaveLength(1)
    })
  })

  describe('transferTasks', () => {
    it('should add transfer task', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      const taskId = useTerminalStore.getState().addTransferTask('conn-1', {
        connectionId: 'conn-1',
        type: 'upload',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024,
        transferred: 0,
        status: 'pending',
      })
      
      const state = useTerminalStore.getState()
      expect(state.transferTasks['conn-1']).toHaveLength(1)
      expect(state.transferTasks['conn-1'][0].id).toBe(taskId)
      expect(state.transferTasks['conn-1'][0].startTime).toBeDefined()
    })

    it('should update transfer task', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const taskId = useTerminalStore.getState().addTransferTask('conn-1', {
        connectionId: 'conn-1',
        type: 'upload',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024,
        transferred: 0,
        status: 'pending',
      })
      
      useTerminalStore.getState().updateTransferTask('conn-1', taskId, {
        transferred: 512,
        status: 'transferring',
      })
      
      const state = useTerminalStore.getState()
      expect(state.transferTasks['conn-1'][0].transferred).toBe(512)
      expect(state.transferTasks['conn-1'][0].status).toBe('transferring')
    })

    it('should remove transfer task', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const taskId = useTerminalStore.getState().addTransferTask('conn-1', {
        connectionId: 'conn-1',
        type: 'upload',
        localPath: '/local/file.txt',
        remotePath: '/remote/file.txt',
        fileName: 'file.txt',
        fileSize: 1024,
        transferred: 0,
        status: 'pending',
      })
      
      useTerminalStore.getState().removeTransferTask('conn-1', taskId)
      
      expect(useTerminalStore.getState().transferTasks['conn-1']).toHaveLength(0)
    })
  })

  describe('terminalSettings', () => {
    it('should update terminal settings', () => {
      useTerminalStore.getState().updateTerminalSettings({
        fontSize: 18,
        fontFamily: 'Monaco',
      })
      
      const state = useTerminalStore.getState()
      expect(state.terminalSettings.fontSize).toBe(18)
      expect(state.terminalSettings.fontFamily).toBe('Monaco')
    })

    it('should clamp fontSize to valid range', () => {
      useTerminalStore.getState().updateTerminalSettings({ fontSize: 5 })
      expect(useTerminalStore.getState().terminalSettings.fontSize).toBe(10)
      
      useTerminalStore.getState().updateTerminalSettings({ fontSize: 30 })
      expect(useTerminalStore.getState().terminalSettings.fontSize).toBe(24)
    })

    it('should clamp scrollback to valid range', () => {
      useTerminalStore.getState().updateTerminalSettings({ scrollback: 50 })
      expect(useTerminalStore.getState().terminalSettings.scrollback).toBe(100)

      useTerminalStore.getState().updateTerminalSettings({ scrollback: 200000 })
      expect(useTerminalStore.getState().terminalSettings.scrollback).toBe(100000)
    })
  })

  describe('shortcutSettings', () => {
    it('should update shortcut settings', () => {
      useTerminalStore.getState().updateShortcutSettings({
        clearScreen: 'Ctrl+K',
        copy: 'Ctrl+C',
      })

      const state = useTerminalStore.getState()
      expect(state.shortcutSettings.clearScreen).toBe('Ctrl+K')
      expect(state.shortcutSettings.copy).toBe('Ctrl+C')
    })

    it('should reset shortcut settings to default', () => {
      useTerminalStore.getState().updateShortcutSettings({
        clearScreen: 'Ctrl+K',
        copy: 'Ctrl+C',
      })

      useTerminalStore.getState().resetShortcutSettings()

      const state = useTerminalStore.getState()
      expect(state.shortcutSettings.clearScreen).toBe('Ctrl+L')
      expect(state.shortcutSettings.copy).toBe('Ctrl+Shift+C')
    })
  })

  describe('splitPane', () => {
    it('should split pane horizontally', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const paneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', paneId, 'horizontal', 'pane-2', 'shell-2')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.splitDirection).toBe('horizontal')
      expect(conn?.rootPane.children).toHaveLength(2)
      expect(countSessionsInPane(conn?.rootPane!)).toBe(2)
    })

    it('should split pane vertically', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const paneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', paneId, 'vertical', 'pane-2', 'shell-2')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.splitDirection).toBe('vertical')
      expect(conn?.rootPane.children).toHaveLength(2)
    })

    it('should support nested splits', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const childPaneId = state2.connectedConnections[0].rootPane.children![1].id

      useTerminalStore.getState().splitPane('conn-1', childPaneId, 'vertical', 'pane-3', 'shell-3')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(countSessionsInPane(conn?.rootPane!)).toBe(3)
      expect(conn?.rootPane.children).toHaveLength(2)
      expect(conn?.rootPane.children![1].children).toHaveLength(2)
    })
  })

  describe('closePane', () => {
    it('should remove split pane', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const childPaneId = state2.connectedConnections[0].rootPane.children![1].id

      useTerminalStore.getState().closePane('conn-1', childPaneId)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.children).toBeUndefined()
      expect(conn?.rootPane.sessions).toHaveLength(1)
    })
  })

  describe('disconnectedConnections', () => {
    it('should mark connection as disconnected', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')

      useTerminalStore.getState().markConnectionDisconnected('conn-1', 'server_close')

      const state = useTerminalStore.getState()
      expect(state.connectedConnections).toHaveLength(0)
      expect(state.disconnectedConnections).toHaveLength(1)
      expect(state.disconnectedConnections[0].connectionId).toBe('conn-1')
      expect(state.disconnectedConnections[0].reason).toBe('server_close')
    })

    it('should preserve sessions when disconnecting', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      useTerminalStore.getState().addSession('conn-1', 'shell-2')

      useTerminalStore.getState().markConnectionDisconnected('conn-1', 'channel_closed')

      const state = useTerminalStore.getState()
      expect(countSessionsInPane(state.disconnectedConnections[0].rootPane)).toBe(2)
    })

    it('should remove disconnected connection', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      useTerminalStore.getState().markConnectionDisconnected('conn-1', 'unknown')

      useTerminalStore.getState().removeDisconnectedConnection('conn-1')

      expect(useTerminalStore.getState().disconnectedConnections).toHaveLength(0)
    })

    it('should clear all disconnected connections', () => {
      const conn2: Connection = { ...mockConnection, id: 'conn-2' }
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      useTerminalStore.getState().addConnection(conn2, 'shell-2')
      useTerminalStore.getState().markConnectionDisconnected('conn-1', 'unknown')
      useTerminalStore.getState().markConnectionDisconnected('conn-2', 'unknown')

      useTerminalStore.getState().clearAllDisconnectedConnections()

      expect(useTerminalStore.getState().disconnectedConnections).toHaveLength(0)
    })
  })

  describe('sidebarCollapsed', () => {
    it('should toggle sidebar collapsed state', () => {
      expect(useTerminalStore.getState().sidebarCollapsed).toBe(false)

      useTerminalStore.getState().setSidebarCollapsed(true)
      expect(useTerminalStore.getState().sidebarCollapsed).toBe(true)

      useTerminalStore.getState().setSidebarCollapsed(false)
      expect(useTerminalStore.getState().sidebarCollapsed).toBe(false)
    })
  })

  describe('activePaneId', () => {
    it('should update activePaneId when setActiveSessionInPane is called in split pane', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const rightPane = state2.connectedConnections[0].rootPane.children![1]
      const rightSessionId = rightPane.sessions[0].id

      useTerminalStore.getState().setActiveSessionInPane('conn-1', rightPane.id, rightSessionId)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.activePaneId).toBe(rightPane.id)
    })

    it('should not set activePaneId when there is no split', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      
      const state1 = useTerminalStore.getState()
      const paneId = state1.connectedConnections[0].rootPane.id
      const sessionId = state1.connectedConnections[0].rootPane.sessions[0].id
      
      useTerminalStore.getState().setActiveSessionInPane('conn-1', paneId, sessionId)

      const state = useTerminalStore.getState()
      expect(state.connectedConnections[0].rootPane.activePaneId).toBeUndefined()
    })
  })

  describe('setActiveSessionInPane', () => {
    it('should update activeSessionId in the correct pane', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const paneId = state1.connectedConnections[0].rootPane.id

      const sessionId2 = useTerminalStore.getState().addSession('conn-1', 'shell-2')

      useTerminalStore.getState().setActiveSessionInPane('conn-1', paneId, sessionId2)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.activeSessionId).toBe(sessionId2)
    })

    it('should find and update nested pane', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')
      
      const state2 = useTerminalStore.getState()
      const rightPane = state2.connectedConnections[0].rootPane.children![1]
      
      useTerminalStore.getState().splitPane('conn-1', rightPane.id, 'vertical', 'pane-3', 'shell-3')

      const state3 = useTerminalStore.getState()
      const nestedPane = state3.connectedConnections[0].rootPane.children![1].children![1]
      const nestedSessionId = nestedPane.sessions[0].id

      useTerminalStore.getState().setActiveSessionInPane('conn-1', nestedPane.id, nestedSessionId)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      const foundPane = conn?.rootPane.children![1].children![1]
      expect(foundPane?.activeSessionId).toBe(nestedSessionId)
    })
  })

  describe('addSessionToPane', () => {
    it('should add session to specific pane and set it as active', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const paneId = state1.connectedConnections[0].rootPane.id

      const newSessionId = useTerminalStore.getState().addSessionToPane('conn-1', paneId, 'shell-2')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.sessions).toHaveLength(2)
      expect(conn?.rootPane.activeSessionId).toBe(newSessionId)
    })

    it('should add session to split pane', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const leftPane = state2.connectedConnections[0].rootPane.children![0]

      useTerminalStore.getState().addSessionToPane('conn-1', leftPane.id, 'shell-3')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      const leftPaneAfter = conn?.rootPane.children![0]
      expect(leftPaneAfter?.sessions).toHaveLength(2)
    })
  })

  describe('closeSessionInPane', () => {
    it('should close session in specific pane', () => {
      vi.useFakeTimers()
      
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      vi.advanceTimersByTime(100)
      const sessionId2 = useTerminalStore.getState().addSession('conn-1', 'shell-2')
      vi.useRealTimers()

      const state2 = useTerminalStore.getState()
      const paneId = state2.connectedConnections[0].rootPane.id

      useTerminalStore.getState().closeSessionInPane('conn-1', paneId, sessionId2)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.rootPane.sessions).toHaveLength(1)
    })
  })

  describe('findPaneBySession', () => {
    it('should find pane by session id', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].rootPane.sessions[0].id

      const pane = useTerminalStore.getState().findPaneBySession('conn-1', sessionId)

      expect(pane).not.toBeNull()
      expect(pane?.sessions.some(s => s.id === sessionId)).toBe(true)
    })

    it('should find pane in nested structure', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const rightPane = state2.connectedConnections[0].rootPane.children![1]
      const rightSessionId = rightPane.sessions[0].id

      const pane = useTerminalStore.getState().findPaneBySession('conn-1', rightSessionId)

      expect(pane?.id).toBe(rightPane.id)
    })
  })

  describe('restoreConnection', () => {
    it('should restore connection with existing rootPane', () => {
      const rootPane: SplitPane = {
        id: 'pane-restored',
        sessions: [
          { id: 'sess-1', connectionId: 'conn-1', shellId: 'shell-restored', title: 'Session 1' }
        ],
        activeSessionId: 'sess-1',
      }

      useTerminalStore.getState().restoreConnection(mockConnection, rootPane)

      const state = useTerminalStore.getState()
      expect(state.connectedConnections).toHaveLength(1)
      expect(state.connectedConnections[0].connectionId).toBe('conn-1')
      expect(state.connectedConnections[0].rootPane.sessions).toHaveLength(1)
      expect(state.connectedConnections[0].rootPane.sessions[0].shellId).toBe('shell-restored')
    })

    it('should restore connection with split panes', () => {
      const rootPane: SplitPane = {
        id: 'pane-root',
        sessions: [],
        activeSessionId: null,
        splitDirection: 'horizontal',
        children: [
          { id: 'pane-left', sessions: [{ id: 'sess-1', connectionId: 'conn-1', shellId: 'shell-1', title: 'Left' }], activeSessionId: 'sess-1' },
          { id: 'pane-right', sessions: [{ id: 'sess-2', connectionId: 'conn-1', shellId: 'shell-2', title: 'Right' }], activeSessionId: 'sess-2' }
        ],
        sizes: [50, 50],
      }

      useTerminalStore.getState().restoreConnection(mockConnection, rootPane)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.splitDirection).toBe('horizontal')
      expect(conn.rootPane.children).toHaveLength(2)
      expect(countSessionsInPane(conn.rootPane)).toBe(2)
    })
  })

  describe('moveSessionToSplitPane', () => {
    it('should move session to new split pane within same pane', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      vi.useFakeTimers()
      vi.advanceTimersByTime(100)
      useTerminalStore.getState().addSession('conn-1', 'shell-2')
      vi.useRealTimers()

      const state1 = useTerminalStore.getState()
      const paneId = state1.connectedConnections[0].rootPane.id
      const sessionToMove = state1.connectedConnections[0].rootPane.sessions[1]

      useTerminalStore.getState().moveSessionToSplitPane(
        'conn-1',
        paneId,
        sessionToMove.id,
        paneId,
        'horizontal',
        'first'
      )

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.splitDirection).toBe('horizontal')
      expect(conn.rootPane.children).toHaveLength(2)
    })

    it('should place moved session in first child when position is first', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      vi.useFakeTimers()
      vi.advanceTimersByTime(100)
      useTerminalStore.getState().addSession('conn-1', 'shell-2')
      vi.useRealTimers()

      const state1 = useTerminalStore.getState()
      const paneId = state1.connectedConnections[0].rootPane.id
      const sessionToMove = state1.connectedConnections[0].rootPane.sessions[1]

      useTerminalStore.getState().moveSessionToSplitPane(
        'conn-1',
        paneId,
        sessionToMove.id,
        paneId,
        'horizontal',
        'first'
      )

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.children![0].sessions[0].id).toBe(sessionToMove.id)
    })
  })

  describe('updatePaneSizes', () => {
    it('should update pane sizes', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const conn2 = state2.connectedConnections[0]
      
      useTerminalStore.getState().updatePaneSizes('conn-1', conn2.rootPane.id, [30, 70])

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.sizes).toEqual([30, 70])
    })
  })

  describe('closeSessionInPane - edge cases', () => {
    it('should leave empty pane when last session is closed', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const rightPane = state2.connectedConnections[0].rootPane.children![1]
      const rightSessionId = rightPane.sessions[0].id

      useTerminalStore.getState().closeSessionInPane('conn-1', rightPane.id, rightSessionId)

      const state = useTerminalStore.getState()
      const rightPaneAfter = state.connectedConnections[0].rootPane.children![1]
      expect(rightPaneAfter.sessions).toHaveLength(0)
    })

    it('should close pane when using closePane', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPane('conn-1', rootPaneId, 'horizontal', 'pane-2', 'shell-2')

      const state2 = useTerminalStore.getState()
      const rightPaneId = state2.connectedConnections[0].rootPane.children![1].id

      useTerminalStore.getState().closePane('conn-1', rightPaneId)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.children).toBeUndefined()
      expect(conn.rootPane.sessions).toHaveLength(1)
    })
  })

  describe('splitPaneWithPosition', () => {
    it('should split pane with position first', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPaneWithPosition(
        'conn-1',
        rootPaneId,
        'horizontal',
        'pane-new',
        'shell-2',
        'first'
      )

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.splitDirection).toBe('horizontal')
      expect(conn.rootPane.children).toHaveLength(2)
      const firstChild = conn.rootPane.children![0]
      expect(firstChild.sessions[0].shellId).toBe('shell-2')
    })

    it('should split pane with position second', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const rootPaneId = state1.connectedConnections[0].rootPane.id

      useTerminalStore.getState().splitPaneWithPosition(
        'conn-1',
        rootPaneId,
        'vertical',
        'pane-new',
        'shell-2',
        'second'
      )

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections[0]
      expect(conn.rootPane.splitDirection).toBe('vertical')
      const secondChild = conn.rootPane.children![1]
      expect(secondChild.sessions[0].shellId).toBe('shell-2')
    })
  })

  describe('updateSessionShellId', () => {
    it('should update session shellId', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].rootPane.sessions[0].id

      useTerminalStore.getState().updateSessionShellId('conn-1', sessionId, 'shell-new')

      const state = useTerminalStore.getState()
      const session = state.connectedConnections[0].rootPane.sessions[0]
      expect(session.shellId).toBe('shell-new')
    })
  })
})