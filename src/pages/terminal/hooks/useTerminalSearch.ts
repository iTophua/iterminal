import { useState, useCallback, useEffect } from 'react'

export function useTerminalSearch(
  searchAddons: React.MutableRefObject<{ [key: string]: any }>,
  connectedConnections: any[],
  activeConnectionId: string | null
) {
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')

  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    if (!searchText) return
    
    const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
    const activeSess = activeConn?.sessions.find((s: any) => s.id === activeConn?.activeSessionId)
    if (!activeSess) return
    
    const key = `${activeSess.connectionId}_${activeSess.id}`
    const searchAddon = searchAddons.current[key]
    
    if (searchAddon) {
      if (direction === 'next') {
        searchAddon.findNext(searchText, { caseSensitive: false, wholeWord: false })
      } else {
        searchAddon.findPrevious(searchText, { caseSensitive: false, wholeWord: false })
      }
    }
  }, [searchText, connectedConnections, activeConnectionId, searchAddons])

  // Ctrl+F 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        const activeSess = activeConn?.sessions.find((s: any) => s.id === activeConn?.activeSessionId)
        if (activeSess) {
          const key = `${activeSess.connectionId}_${activeSess.id}`
          const terminalInstances = (window as any).__terminalInstances || {}
          const term = terminalInstances[key]
          if (term && term.hasSelection()) {
            setSearchText(term.getSelection())
          }
        }
        setSearchVisible(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeConnectionId, connectedConnections])

  const closeSearch = useCallback(() => {
    setSearchVisible(false)
    setSearchText('')
  }, [])

  return {
    searchVisible,
    searchText,
    setSearchText,
    handleSearch,
    setSearchVisible,
    closeSearch,
  }
}