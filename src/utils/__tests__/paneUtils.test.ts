import { describe, it, expect } from 'vitest'
import { 
  getAllSessions, 
  getActiveSessionInPane, 
  findPaneBySessionId, 
  hasSplitChildren, 
  getVisibleSessions 
} from '../paneUtils'
import type { SplitPane, Session } from '../../stores/terminalStore'

const createMockSession = (id: string, shellId: string, connectionId: string = 'conn-1'): Session => ({
  id,
  shellId,
  connectionId,
  title: `Session ${id}`,
})

const createMockPane = (
  id: string,
  sessions: Session[] = [],
  options: {
    activeSessionId?: string
    activePaneId?: string
    splitDirection?: 'horizontal' | 'vertical'
    children?: SplitPane[]
    sizes?: number[]
  } = {}
): SplitPane => ({
  id,
  sessions,
  activeSessionId: options.activeSessionId ?? null,
  activePaneId: options.activePaneId,
  splitDirection: options.splitDirection,
  children: options.children,
  sizes: options.sizes,
})

describe('paneUtils', () => {
  describe('getAllSessions', () => {
    it('should return sessions from simple pane', () => {
      const sessions = [
        createMockSession('sess-1', 'shell-1'),
        createMockSession('sess-2', 'shell-2'),
      ]
      const pane = createMockPane('pane-1', sessions)

      const result = getAllSessions(pane)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('sess-1')
      expect(result[1].id).toBe('sess-2')
    })

    it('should return sessions from nested panes', () => {
      const pane = createMockPane('pane-root', [], {
        splitDirection: 'horizontal',
        children: [
          createMockPane('pane-left', [createMockSession('sess-1', 'shell-1')]),
          createMockPane('pane-right', [
            createMockSession('sess-2', 'shell-2'),
            createMockSession('sess-3', 'shell-3'),
          ]),
        ],
      })

      const result = getAllSessions(pane)

      expect(result).toHaveLength(3)
      expect(result.map(s => s.id)).toEqual(['sess-1', 'sess-2', 'sess-3'])
    })

    it('should return empty array for empty pane', () => {
      const pane = createMockPane('pane-1', [])
      const result = getAllSessions(pane)
      expect(result).toHaveLength(0)
    })
  })

  describe('getActiveSessionInPane', () => {
    it('should return first session when no activeSessionId', () => {
      const sessions = [
        createMockSession('sess-1', 'shell-1'),
        createMockSession('sess-2', 'shell-2'),
      ]
      const pane = createMockPane('pane-1', sessions)

      const result = getActiveSessionInPane(pane)

      expect(result?.id).toBe('sess-1')
    })

    it('should return active session when activeSessionId is set', () => {
      const sessions = [
        createMockSession('sess-1', 'shell-1'),
        createMockSession('sess-2', 'shell-2'),
      ]
      const pane = createMockPane('pane-1', sessions, { activeSessionId: 'sess-2' })

      const result = getActiveSessionInPane(pane)

      expect(result?.id).toBe('sess-2')
    })

    it('should return session from active child pane', () => {
      const pane = createMockPane('pane-root', [], {
        activePaneId: 'pane-right',
        splitDirection: 'horizontal',
        children: [
          createMockPane('pane-left', [createMockSession('sess-1', 'shell-1')]),
          createMockPane('pane-right', [createMockSession('sess-2', 'shell-2')]),
        ],
      })

      const result = getActiveSessionInPane(pane)

      expect(result?.id).toBe('sess-2')
    })

    it('should return null for empty pane', () => {
      const pane = createMockPane('pane-1', [])
      const result = getActiveSessionInPane(pane)
      expect(result).toBeNull()
    })
  })

  describe('findPaneBySessionId', () => {
    it('should find pane containing session', () => {
      const sessions = [createMockSession('sess-1', 'shell-1')]
      const pane = createMockPane('pane-1', sessions)

      const result = findPaneBySessionId(pane, 'sess-1')

      expect(result?.id).toBe('pane-1')
    })

    it('should find pane in nested structure', () => {
      const pane = createMockPane('pane-root', [], {
        splitDirection: 'horizontal',
        children: [
          createMockPane('pane-left', [createMockSession('sess-1', 'shell-1')]),
          createMockPane('pane-right', [createMockSession('sess-2', 'shell-2')]),
        ],
      })

      const result = findPaneBySessionId(pane, 'sess-2')

      expect(result?.id).toBe('pane-right')
    })

    it('should return null if session not found', () => {
      const pane = createMockPane('pane-1', [createMockSession('sess-1', 'shell-1')])

      const result = findPaneBySessionId(pane, 'non-existent')

      expect(result).toBeNull()
    })
  })

  describe('hasSplitChildren', () => {
    it('should return true for pane with children', () => {
      const pane = createMockPane('pane-root', [], {
        splitDirection: 'horizontal',
        children: [
          createMockPane('pane-left', []),
          createMockPane('pane-right', []),
        ],
      })

      expect(hasSplitChildren(pane)).toBe(true)
    })

    it('should return false for pane without children', () => {
      const pane = createMockPane('pane-1', [createMockSession('sess-1', 'shell-1')])

      expect(hasSplitChildren(pane)).toBe(false)
    })

    it('should return false for null pane', () => {
      expect(hasSplitChildren(null)).toBe(false)
    })
  })

  describe('getVisibleSessions', () => {
    it('should return sessions from leaf panes', () => {
      const pane = createMockPane('pane-root', [], {
        splitDirection: 'horizontal',
        children: [
          createMockPane('pane-left', [
            createMockSession('sess-1', 'shell-1'),
            createMockSession('sess-2', 'shell-2'),
          ]),
          createMockPane('pane-right', [createMockSession('sess-3', 'shell-3')]),
        ],
      })

      const result = getVisibleSessions(pane)

      expect(result).toHaveLength(3)
      expect(result.map(s => s.id)).toEqual(['sess-1', 'sess-2', 'sess-3'])
    })

    it('should return sessions from simple pane', () => {
      const sessions = [createMockSession('sess-1', 'shell-1')]
      const pane = createMockPane('pane-1', sessions)

      const result = getVisibleSessions(pane)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('sess-1')
    })

    it('should return empty array for empty pane', () => {
      const pane = createMockPane('pane-1', [])
      const result = getVisibleSessions(pane)
      expect(result).toHaveLength(0)
    })
  })
})