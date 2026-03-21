import { useState, useCallback } from 'react'
import { message } from 'antd'
import { SearchAddon } from 'xterm-addon-search'
import { SearchMode } from './types'

export type { SearchMode } from './types'

export function useTerminalSearch() {
  const [visible, setVisible] = useState(false)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<SearchMode>('normal')
  
  const search = useCallback((
    searchAddon: SearchAddon | null,
    searchText: string,
    searchMode: SearchMode,
    direction: 'next' | 'prev' = 'next'
  ) => {
    if (!searchAddon || !searchText) return false
    
    let found = false
    if (searchMode === 'regex') {
      found = searchAddon.findNext(searchText, { regex: true })
    } else if (searchMode === 'wholeWord') {
      found = searchAddon.findNext(searchText, { wholeWord: true })
    } else {
      found = direction === 'next' 
        ? searchAddon.findNext(searchText, { caseSensitive: false })
        : searchAddon.findPrevious(searchText, { caseSensitive: false })
    }
    
    return found
  }, [])
  
  const handleSearch = useCallback((
    searchAddon: SearchAddon | null,
    direction: 'next' | 'prev' = 'next'
  ) => {
    const found = search(searchAddon, text, mode, direction)
    if (!found) {
      message.info('未找到匹配内容')
    }
    return found
  }, [text, mode, search])
  
  const clearSearch = useCallback((searchAddon: SearchAddon | null) => {
    setText('')
    searchAddon?.clearDecorations()
  }, [])
  
  const toggleVisible = useCallback(() => {
    setVisible(v => !v)
  }, [])
  
  return {
    visible,
    text,
    mode,
    setText,
    setMode,
    handleSearch,
    clearSearch,
    toggleVisible,
    setVisible,
  }
}