import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useTransferStore, TransferRecord } from '../transferStore'

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

vi.useFakeTimers()

describe('transferStore', () => {
  const mockRecord: TransferRecord = {
    id: 'task-1',
    connectionId: 'conn-1',
    connectionName: 'Test Server',
    connectionHost: '192.168.1.1',
    type: 'upload',
    localPath: '/local/file.txt',
    remotePath: '/remote/file.txt',
    fileName: 'file.txt',
    fileSize: 1024,
    transferred: 0,
    status: 'pending',
    startTime: Date.now(),
  }

  beforeEach(() => {
    mockLocalStorage.clear()
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    
    useTransferStore.setState({
      records: [],
      progress: {},
      transferringCount: 0,
      retentionPeriod: '1month',
      lastCleanupTime: 0,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('addRecord', () => {
    it('should add a record to the beginning', () => {
      useTransferStore.getState().addRecord(mockRecord)
      
      const state = useTransferStore.getState()
      expect(state.records).toHaveLength(1)
      expect(state.records[0].id).toBe('task-1')
    })

    it('should increment transferringCount for transferring status', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'transferring' })
      
      expect(useTransferStore.getState().transferringCount).toBe(1)
    })

    it('should not increment transferringCount for other status', () => {
      useTransferStore.getState().addRecord(mockRecord)
      
      expect(useTransferStore.getState().transferringCount).toBe(0)
    })
  })

  describe('updateRecord', () => {
    it('should update record fields', () => {
      useTransferStore.getState().addRecord(mockRecord)
      
      useTransferStore.getState().updateRecord('task-1', {
        transferred: 512,
        status: 'transferring',
      })
      
      const state = useTransferStore.getState()
      expect(state.records[0].transferred).toBe(512)
      expect(state.records[0].status).toBe('transferring')
    })

    it('should update transferringCount when status changes', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'transferring' })
      
      useTransferStore.getState().updateRecord('task-1', { status: 'completed' })
      
      expect(useTransferStore.getState().transferringCount).toBe(0)
    })
  })

  describe('removeRecord', () => {
    it('should remove record by id', () => {
      useTransferStore.getState().addRecord(mockRecord)
      
      useTransferStore.getState().removeRecord('task-1')
      
      expect(useTransferStore.getState().records).toHaveLength(0)
    })

    it('should decrement transferringCount when removing transferring record', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'transferring' })
      
      useTransferStore.getState().removeRecord('task-1')
      
      expect(useTransferStore.getState().transferringCount).toBe(0)
    })

    it('should remove progress for the record', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'transferring' })
      useTransferStore.getState().updateProgress('task-1', 512, 1024)
      
      useTransferStore.getState().removeRecord('task-1')
      
      expect(useTransferStore.getState().progress['task-1']).toBeUndefined()
    })
  })

  describe('clearRecords', () => {
    it('should clear all records and progress', () => {
      useTransferStore.getState().addRecord(mockRecord)
      useTransferStore.getState().addRecord({ ...mockRecord, id: 'task-2' })
      
      useTransferStore.getState().clearRecords()
      
      const state = useTransferStore.getState()
      expect(state.records).toHaveLength(0)
      expect(state.progress).toEqual({})
      expect(state.transferringCount).toBe(0)
    })
  })

  describe('updateProgress', () => {
    it('should track progress with speed calculation', () => {
      useTransferStore.getState().updateProgress('task-1', 512, 1024)
      
      vi.advanceTimersByTime(1000)
      useTransferStore.getState().updateProgress('task-1', 1024, 1024)
      
      const state = useTransferStore.getState()
      expect(state.progress['task-1']).toBeDefined()
      expect(state.progress['task-1'].transferred).toBe(1024)
      expect(state.progress['task-1'].speed).toBeGreaterThan(0)
    })
  })

  describe('cancelRecord', () => {
    it('should set status to cancelled', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'transferring' })
      
      useTransferStore.getState().cancelRecord('task-1')
      
      const state = useTransferStore.getState()
      expect(state.records[0].status).toBe('cancelled')
      expect(state.records[0].endTime).toBeDefined()
    })

    it('should decrement transferringCount', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'transferring' })
      
      useTransferStore.getState().cancelRecord('task-1')
      
      expect(useTransferStore.getState().transferringCount).toBe(0)
    })

    it('should do nothing if record not found or not transferring', () => {
      useTransferStore.getState().addRecord(mockRecord)
      
      useTransferStore.getState().cancelRecord('task-1')
      
      expect(useTransferStore.getState().records[0].status).toBe('pending')
    })
  })

  describe('setRetentionPeriod', () => {
    it('should update retention period', () => {
      useTransferStore.getState().setRetentionPeriod('3months')
      
      expect(useTransferStore.getState().retentionPeriod).toBe('3months')
    })
  })

  describe('cleanupExpiredRecords', () => {
    it('should remove records older than retention period', () => {
      const oneMonthAgo = Date.now() - 31 * 24 * 60 * 60 * 1000
      const oldRecord: TransferRecord = {
        ...mockRecord,
        id: 'old-task',
        startTime: oneMonthAgo,
      }

      useTransferStore.setState({ records: [oldRecord, mockRecord], retentionPeriod: '1month' })

      useTransferStore.getState().cleanupExpiredRecords()

      const state = useTransferStore.getState()
      expect(state.records).toHaveLength(1)
      expect(state.records[0].id).toBe('task-1')
    })

    it('should keep all records when retention is forever', () => {
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
      const oldRecord: TransferRecord = {
        ...mockRecord,
        id: 'old-task',
        startTime: oneYearAgo,
      }

      useTransferStore.setState({ records: [oldRecord, mockRecord], retentionPeriod: 'forever' })

      useTransferStore.getState().cleanupExpiredRecords()

      expect(useTransferStore.getState().records).toHaveLength(2)
    })
  })

  describe('pauseRecord', () => {
    it('should set status to paused', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'transferring' })

      useTransferStore.getState().pauseRecord('task-1')

      const state = useTransferStore.getState()
      expect(state.records[0].status).toBe('paused')
      expect(state.records[0].paused).toBe(true)
    })

    it('should not pause non-transferring record', () => {
      useTransferStore.getState().addRecord(mockRecord)

      useTransferStore.getState().pauseRecord('task-1')

      expect(useTransferStore.getState().records[0].status).toBe('pending')
    })
  })

  describe('resumeRecord', () => {
    it('should set status back to transferring', () => {
      useTransferStore.getState().addRecord({ ...mockRecord, status: 'paused', paused: true })

      useTransferStore.getState().resumeRecord('task-1')

      const state = useTransferStore.getState()
      expect(state.records[0].status).toBe('transferring')
      expect(state.records[0].paused).toBe(false)
    })

    it('should not resume non-paused record', () => {
      useTransferStore.getState().addRecord(mockRecord)

      useTransferStore.getState().resumeRecord('task-1')

      expect(useTransferStore.getState().records[0].status).toBe('pending')
    })
  })
})