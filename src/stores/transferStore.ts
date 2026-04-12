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
  speed: number // 字节/秒
  lastTransferred: number
  lastTime: number
  totalFiles?: number
  completedFiles?: number
}

interface TransferState {
  records: TransferRecord[]
  progress: Record<string, TransferProgress>
  transferringCount: number
  retentionPeriod: RetentionPeriod
  lastCleanupTime: number

  addRecord: (record: TransferRecord) => void
  updateRecord: (id: string, updates: Partial<TransferRecord>) => void
  updateProgress: (id: string, transferred: number, fileSize: number, totalFiles?: number, completedFiles?: number, speed?: number) => void
  removeRecord: (id: string) => void
  clearRecords: () => void
  setRetentionPeriod: (period: RetentionPeriod) => void
  cleanupExpiredRecords: () => void
  loadFromStorage: () => void
  saveToStorage: () => void
  cancelRecord: (id: string) => void
  pauseRecord: (id: string) => void
  resumeRecord: (id: string) => void
}

const RECORDS_STORAGE_KEY = 'iterminal_transfer_records'
const RETENTION_STORAGE_KEY = 'iterminal_transfer_retention'

function loadInitialData(): { records: TransferRecord[]; retentionPeriod: RetentionPeriod } {
  try {
    const recordsStr = localStorage.getItem(RECORDS_STORAGE_KEY)
    const records: TransferRecord[] = recordsStr ? JSON.parse(recordsStr) : []
    const retentionStr = localStorage.getItem(RETENTION_STORAGE_KEY)
    const retentionPeriod: RetentionPeriod = retentionStr ? 
      (JSON.parse(retentionStr) as RetentionPeriod) : '1month'
    return { records, retentionPeriod }
  } catch (error) {
    console.error('Failed to load transfer records from storage:', error)
    return { records: [], retentionPeriod: '1month' }
  }
}

function filterExpiredRecords(records: TransferRecord[], period: RetentionPeriod): TransferRecord[] {
  if (period === 'forever') return records
  
  const retentionMs = {
    '1month': 30 * 24 * 60 * 60 * 1000,
    '3months': 90 * 24 * 60 * 60 * 1000,
    '5months': 150 * 24 * 60 * 60 * 1000,
  }[period] || 30 * 24 * 60 * 60 * 1000
  
  const cutoffTime = Date.now() - retentionMs
  return records.filter(record => record.startTime >= cutoffTime)
}

const initialData = loadInitialData()
const cleanedRecords = filterExpiredRecords(initialData.records, initialData.retentionPeriod)
if (cleanedRecords.length !== initialData.records.length) {
  localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(cleanedRecords))
}

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

  const saveToStorage = (): void => {
    try {
      const { records, retentionPeriod } = get()
      localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records))
      localStorage.setItem(RETENTION_STORAGE_KEY, JSON.stringify(retentionPeriod))
    } catch (error) {
      console.error('Failed to save transfer records to storage:', error)
    }
  }

  const loadFromStorage = (): void => {
    const data = loadInitialData()
    set({ records: data.records, retentionPeriod: data.retentionPeriod, lastCleanupTime: Date.now() })
  }

return {
    records: cleanedRecords,
    progress: {},
    transferringCount: 0,
    retentionPeriod: initialData.retentionPeriod,
    lastCleanupTime: cleanedRecords.length > 0 ? Date.now() : 0,

    addRecord: (record: TransferRecord) => {
      set((state) => {
        const newRecords = [record, ...state.records]
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

    updateProgress: (id: string, transferred: number, fileSize: number, totalFiles?: number, completedFiles?: number, speedOverride?: number) => {
      set((state) => {
        const now = Date.now()
        const prevProgress = state.progress[id]

        let speed = speedOverride ?? 0
        if (!speedOverride && prevProgress && prevProgress.lastTime > 0) {
          const timeDiff = (now - prevProgress.lastTime) / 1000
          const bytesDiff = transferred - prevProgress.lastTransferred
          if (timeDiff > 0) {
            speed = Math.round(bytesDiff / timeDiff)
          }
        }
        
        return {
          progress: {
            ...state.progress,
            [id]: {
              transferred,
              fileSize,
              speed,
              lastTransferred: transferred,
              lastTime: now,
              totalFiles,
              completedFiles
            }
          }
        }
      })
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
    saveToStorage,

    cancelRecord: (id: string) => {
      set((state) => {
        const record = state.records.find(r => r.id === id)
        if (!record || record.status !== 'transferring') return state

        const newRecords = state.records.map(r =>
          r.id === id ? { ...r, status: 'cancelled' as const, endTime: Date.now() } : r
        )
        const newProgress = { ...state.progress }
        delete newProgress[id]

        return {
          records: newRecords,
          progress: newProgress,
          transferringCount: Math.max(0, state.transferringCount - 1)
        }
      })
      saveToStorage()
    },

    pauseRecord: (id: string) => {
      set((state) => {
        const newRecords = state.records.map(r =>
          r.id === id && r.status === 'transferring' 
            ? { ...r, status: 'paused' as const, paused: true } 
            : r
        )
        return { records: newRecords }
      })
    },

    resumeRecord: (id: string) => {
      set((state) => {
        const newRecords = state.records.map(r =>
          r.id === id && r.status === 'paused' 
            ? { ...r, status: 'transferring' as const, paused: false } 
            : r
        )
        return { records: newRecords }
      })
    }
  }
})

setInterval(() => {
  useTransferStore.getState().cleanupExpiredRecords()
}, 60 * 60 * 1000)