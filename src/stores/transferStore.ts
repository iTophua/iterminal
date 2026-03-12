import { create } from 'zustand'

import { TransferTask } from './terminalStore'

export interface TransferRecord extends TransferTask {
  connectionName: string
  connectionHost: string
}

export type RetentionPeriod = '1month' | '3months' | '5months' | 'forever'

interface TransferProgress {
  transferred: number
  fileSize: number
}

interface TransferState {
  records: TransferRecord[]
  progress: Record<string, TransferProgress>
  transferringCount: number
  retentionPeriod: RetentionPeriod
  lastCleanupTime: number

  addRecord: (record: TransferRecord) => void
  updateRecord: (id: string, updates: Partial<TransferRecord>) => void
  updateProgress: (id: string, transferred: number, fileSize: number) => void
  removeRecord: (id: string) => void
  clearRecords: () => void
  setRetentionPeriod: (period: RetentionPeriod) => void
  cleanupExpiredRecords: () => void
  loadFromStorage: () => void
  saveToStorage: () => void
}

const RECORDS_STORAGE_KEY = 'iterminal_transfer_records'
const RETENTION_STORAGE_KEY = 'iterminal_transfer_retention'

export const useTransferStore = create<TransferState>((set, get) => {
  const getRetentionMs = (period: RetentionPeriod): number => {
    switch (period) {
      case '1month':
        return 30 * 24 * 60 * 60 * 1000
      case '3months':
        return 90 * 24 * 60 * 60 * 1000
      case '5months':
        return 150 * 24 * 60 * 60 * 1000
      case 'forever':
        return Infinity
      default:
        return 30 * 24 * 60 * 60 * 1000
    }
  }

  const loadFromStorage = (): void => {
    try {
      const recordsStr = localStorage.getItem(RECORDS_STORAGE_KEY)
      const records: TransferRecord[] = recordsStr ? JSON.parse(recordsStr) : []

      const retentionStr = localStorage.getItem(RETENTION_STORAGE_KEY)
      const retentionPeriod: RetentionPeriod = retentionStr ? 
        (JSON.parse(retentionStr) as RetentionPeriod) : '1month'

      const lastCleanupTime = records.length > 0 ? Date.now() : 0

      set({ records, retentionPeriod, lastCleanupTime })
    } catch (error) {
      console.error('Failed to load transfer records from storage:', error)
      set({ records: [], retentionPeriod: '1month', lastCleanupTime: 0 })
    }
  }

  const saveToStorage = (): void => {
    try {
      const { records, retentionPeriod } = get()
      localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records))
      localStorage.setItem(RETENTION_STORAGE_KEY, JSON.stringify(retentionPeriod))
    } catch (error) {
      console.error('Failed to save transfer records to storage:', error)
    }
  }

  loadFromStorage()

return {
    records: [],
    progress: {},
    transferringCount: 0,
    retentionPeriod: '1month',
    lastCleanupTime: 0,

    addRecord: (record: TransferRecord) => {
      set((state) => {
        const newRecords = [...state.records, record]
        const newTransferringCount = record.status === 'transferring' 
          ? state.transferringCount + 1 
          : state.transferringCount
        return { records: newRecords, transferringCount: newTransferringCount }
      })
      saveToStorage()
    },

    updateRecord: (id: string, updates: Partial<TransferRecord>) => {
      set((state) => {
        const oldRecord = state.records.find(r => r.id === id)
        const wasTransferring = oldRecord?.status === 'transferring'
        const isNowTransferring = updates.status === 'transferring'
        const isNowComplete = updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled'
        
        let newTransferringCount = state.transferringCount
        if (wasTransferring && isNowComplete) {
          newTransferringCount = Math.max(0, state.transferringCount - 1)
        } else if (!wasTransferring && isNowTransferring) {
          newTransferringCount = state.transferringCount + 1
        }

        const newRecords = state.records.map(record =>
          record.id === id ? { ...record, ...updates } : record
        )
        return { records: newRecords, transferringCount: newTransferringCount }
      })
      if (updates.status && updates.status !== 'transferring') {
        saveToStorage()
      }
    },

    updateProgress: (id: string, transferred: number, fileSize: number) => {
      set((state) => ({
        progress: { ...state.progress, [id]: { transferred, fileSize } }
      }))
    },

    removeRecord: (id: string) => {
      set((state) => {
        const record = state.records.find(r => r.id === id)
        const wasTransferring = record?.status === 'transferring'
        const newRecords = state.records.filter(record => record.id !== id)
        const newProgress = { ...state.progress }
        delete newProgress[id]
        const newTransferringCount = wasTransferring 
          ? Math.max(0, state.transferringCount - 1) 
          : state.transferringCount
        return { records: newRecords, progress: newProgress, transferringCount: newTransferringCount }
      })
      saveToStorage()
    },

    clearRecords: () => {
      set({ records: [], progress: {}, transferringCount: 0 })
      saveToStorage()
    },

    setRetentionPeriod: (period: RetentionPeriod) => {
      set({ retentionPeriod: period })
      saveToStorage()
      get().cleanupExpiredRecords()
    },

    cleanupExpiredRecords: () => {
      const { records, retentionPeriod } = get()
      
      if (retentionPeriod === 'forever') {
        set({ lastCleanupTime: Date.now() })
        return
      }

      const retentionMs = getRetentionMs(retentionPeriod)
      const now = Date.now()
      const cutoffTime = now - retentionMs

      const validRecords = records.filter(record => record.startTime >= cutoffTime)
      
      if (validRecords.length !== records.length) {
        set({ records: validRecords, lastCleanupTime: now })
        saveToStorage()
      } else {
        set({ lastCleanupTime: now })
      }
    },

    loadFromStorage,
    saveToStorage
  }
})