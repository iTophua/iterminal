import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useTerminalStore, Connection, DEFAULT_TERMINAL_SETTINGS } from '../terminalStore'

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
      expect(state.connectedConnections[0].sessions).toHaveLength(1)
      expect(state.connectedConnections[0].sessions[0].shellId).toBe('shell-1')
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
      expect(conn?.sessions).toHaveLength(2)
      expect(conn?.activeSessionId).toBe(sessionId)
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
      const firstSessionId = stateBeforeAdd.connectedConnections[0].sessions[0].id
      
      vi.useFakeTimers()
      vi.advanceTimersByTime(100)
      const sessionId = useTerminalStore.getState().addSession('conn-1', 'shell-2')
      vi.useRealTimers()
      
      useTerminalStore.getState().closeSession('conn-1', sessionId)
      
      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.sessions).toHaveLength(1)
      expect(conn?.sessions[0].id).toBe(firstSessionId)
    })

    it('should remove entire connection when last session is closed', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].sessions[0].id
      
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
      const sessionId = state1.connectedConnections[0].sessions[0].id
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
      expect(conn?.activeSessionId).toBe(sessionId)
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

  describe('splitSession', () => {
    it('should split session horizontally', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].sessions[0].id

      useTerminalStore.getState().splitSession('conn-1', sessionId, 'horizontal', 'shell-2')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.sessions[0].splitDirection).toBe('horizontal')
      expect(conn?.sessions[0].splitPanels).toHaveLength(1)
      expect(conn?.sessions[0].splitPanels?.[0].shellId).toBe('shell-2')
    })

    it('should split session vertically', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].sessions[0].id

      useTerminalStore.getState().splitSession('conn-1', sessionId, 'vertical', 'shell-2')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.sessions[0].splitDirection).toBe('vertical')
    })

    it('should add multiple split panels', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].sessions[0].id

      useTerminalStore.getState().splitSession('conn-1', sessionId, 'horizontal', 'shell-2')
      useTerminalStore.getState().splitSession('conn-1', sessionId, 'horizontal', 'shell-3')

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.sessions[0].splitPanels).toHaveLength(2)
    })
  })

  describe('closeSplitPanel', () => {
    it('should remove split panel', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      const state1 = useTerminalStore.getState()
      const sessionId = state1.connectedConnections[0].sessions[0].id

      useTerminalStore.getState().splitSession('conn-1', sessionId, 'horizontal', 'shell-2')

      const state2 = useTerminalStore.getState()
      const panelId = state2.connectedConnections[0].sessions[0].splitPanels?.[0].id

      useTerminalStore.getState().closeSplitPanel('conn-1', sessionId, panelId!)

      const state = useTerminalStore.getState()
      const conn = state.connectedConnections.find(c => c.connectionId === 'conn-1')
      expect(conn?.sessions[0].splitPanels).toBeUndefined()
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
      expect(state.disconnectedConnections[0].sessions).toHaveLength(2)
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

  describe('reorderSessions', () => {
    it('should reorder sessions within connection', () => {
      useTerminalStore.getState().addConnection(mockConnection, 'shell-1')
      vi.useFakeTimers()
      vi.advanceTimersByTime(100)
      useTerminalStore.getState().addSession('conn-1', 'shell-2')
      vi.advanceTimersByTime(100)
      useTerminalStore.getState().addSession('conn-1', 'shell-3')
      vi.useRealTimers()

      const stateBefore = useTerminalStore.getState()
      const sessions = stateBefore.connectedConnections[0].sessions
      const firstId = sessions[0].id
      const secondId = sessions[1].id
      const thirdId = sessions[2].id

      useTerminalStore.getState().reorderSessions('conn-1', 0, 2)

      const state = useTerminalStore.getState()
      const reordered = state.connectedConnections[0].sessions
      expect(reordered[0].id).toBe(secondId)
      expect(reordered[1].id).toBe(thirdId)
      expect(reordered[2].id).toBe(firstId)
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
})