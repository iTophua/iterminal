import { useState, useCallback } from 'react'

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

  const closeSearch = useCallback(() => {
    setSearchVisible(false)
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