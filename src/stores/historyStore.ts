import { create } from 'zustand'
import { CommandRecord } from '../types/history'
import { loadCommandHistory, saveCommandToHistory, clearCommandHistory, matchHistory, sortHistory, readShellHistory } from '../services/historyService'
import { shouldSaveCommand } from '../constants/commandBlacklist'
import { buildImportedHistory } from '../utils/shellHistory'

interface HistoryState {
  caches: Map<string, CommandRecord[]>
  loading: Map<string, boolean>
  suggestions: CommandRecord[]
  selectedIndex: number
  currentPrefix: string
  activeConnectionId: string | null
  /** 导入的服务器 shell 历史（每连接一份）：只作命令提示候选，不进历史弹窗、不落库 */
  importedHistory: Map<string, CommandRecord[]>
  /** 已尝试过导入的连接：本次运行内每个连接只导入一次 */
  importAttempts: Map<string, boolean>

  loadHistory: (connectionId: string) => Promise<void>
  addCommand: (connectionId: string, text: string) => Promise<void>
  clearConnectionHistory: (connectionId: string) => void
  /** 读取服务器上的 shell 历史，导入为该连接的命令提示候选 */
  importShellHistory: (connectionId: string) => Promise<void>
  /** 丢弃全部导入的历史，并允许下次连接重新导入 */
  clearImportedHistory: () => void
  match: (connectionId: string, prefix: string) => void
  selectPrev: () => number
  selectNext: () => number
  accept: () => string | null
  clearSuggestions: () => void
  setActiveConnection: (connectionId: string | null) => void
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  caches: new Map(),
  loading: new Map(),
  suggestions: [],
  selectedIndex: 0,
  currentPrefix: '',
  activeConnectionId: null,
  importedHistory: new Map(),
  importAttempts: new Map(),

  loadHistory: async (connectionId: string) => {
    const { caches, loading } = get()
    
    // 已有缓存，不重复加载
    if (caches.has(connectionId)) return
    
    // 正在加载中
    if (loading.get(connectionId)) return
    
    set(state => {
      const newLoading = new Map(state.loading)
      newLoading.set(connectionId, true)
      return { loading: newLoading }
    })
    
    try {
      const history = await loadCommandHistory(connectionId)
      const sortedHistory = sortHistory(history)
      
      set(state => {
        const newCaches = new Map(state.caches)
        newCaches.set(connectionId, sortedHistory)
        const newLoading = new Map(state.loading)
        newLoading.delete(connectionId)
        return { caches: newCaches, loading: newLoading }
      })
    } catch (error) {
      console.error('[HistoryStore] Failed to load history:', error)
      set(state => {
        const newLoading = new Map(state.loading)
        newLoading.delete(connectionId)
        return { loading: newLoading }
      })
    }
  },

  addCommand: async (connectionId: string, text: string) => {
    const cleanText = text.replace(/\^([CDZ])/g, '').trim()
    
    if (!shouldSaveCommand(cleanText)) return
    
    set(state => {
      const cache = state.caches.get(connectionId) || []
      
      const existingIndex = cache.findIndex(r => r.text === cleanText)
      let newCache: CommandRecord[]
      
      if (existingIndex >= 0) {
        newCache = cache.map((r, i) => 
          i === existingIndex 
            ? { ...r, timestamp: Date.now(), count: r.count + 1 }
            : r
        )
      } else {
        newCache = [
          { text: cleanText, timestamp: Date.now(), count: 1 },
          ...cache
        ]
      }
      
      const sortedCache = sortHistory(newCache).slice(0, 1000)
      
      const newCaches = new Map(state.caches)
      newCaches.set(connectionId, sortedCache)
      
      return { caches: newCaches }
    })
    
    saveCommandToHistory(connectionId, cleanText).catch(err => {
      console.error('[HistoryStore] Failed to save command:', err)
    })
  },

  clearConnectionHistory: (connectionId: string) => {
    set(state => {
      const newCaches = new Map(state.caches)
      newCaches.delete(connectionId)
      const newLoading = new Map(state.loading)
      newLoading.delete(connectionId)
      return { caches: newCaches, loading: newLoading }
    })
    
    clearCommandHistory(connectionId).catch(err => {
      console.error('[HistoryStore] Failed to clear history:', err)
    })
  },

  match: (connectionId: string, prefix: string) => {
    const { caches } = get()
    const cache = caches.get(connectionId) || []
    
    if (!prefix) {
      set({ suggestions: [], selectedIndex: 0, currentPrefix: '' })
      return
    }
    
    const suggestions = matchHistory(prefix, cache)
    set({ suggestions, selectedIndex: 0, currentPrefix: prefix })
  },

  selectPrev: () => {
    const { suggestions, selectedIndex } = get()
    if (suggestions.length === 0) return -1
    
    const newIndex = selectedIndex > 0 ? selectedIndex - 1 : suggestions.length - 1
    set({ selectedIndex: newIndex })
    return newIndex
  },

  selectNext: () => {
    const { suggestions, selectedIndex } = get()
    if (suggestions.length === 0) return -1
    
    const newIndex = selectedIndex < suggestions.length - 1 ? selectedIndex + 1 : 0
    set({ selectedIndex: newIndex })
    return newIndex
  },

  accept: () => {
    const { suggestions, selectedIndex, currentPrefix } = get()
    if (suggestions.length === 0) return null
    
    const selected = suggestions[selectedIndex]
    if (!selected) return null
    
    return selected.text.slice(currentPrefix.length)
  },

  clearSuggestions: () => {
    set({ suggestions: [], selectedIndex: 0, currentPrefix: '' })
  },

  setActiveConnection: (connectionId: string | null) => {
    set({ activeConnectionId: connectionId, suggestions: [], selectedIndex: 0, currentPrefix: '' })
  },

  importShellHistory: async (connectionId) => {
    if (get().importAttempts.get(connectionId)) return
    set(state => ({ importAttempts: new Map(state.importAttempts).set(connectionId, true) }))

    try {
      const files = await readShellHistory(connectionId)
      const own = (get().caches.get(connectionId) ?? []).map(record => record.text)
      const imported = buildImportedHistory(files, own, Date.now())
      if (imported.length) {
        set(state => ({ importedHistory: new Map(state.importedHistory).set(connectionId, imported) }))
      }
    } catch (error) {
      // 服务器没开 SFTP、历史文件不可读等都属于正常情况，命令提示退回只用本应用的历史
      console.debug('[HistoryStore] Failed to import shell history:', error)
    }
  },

  clearImportedHistory: () => set({ importedHistory: new Map(), importAttempts: new Map() }),
}))