import { useState, useCallback, useEffect } from 'react'

interface ContextMenuState {
  x: number
  y: number
  visible: boolean
  sessionKey: string
}

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    visible: false,
    sessionKey: '',
  })

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionKey: string) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true,
      sessionKey,
    })
  }, [])

  const hideContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (contextMenu.visible) {
        const menuEl = document.getElementById('terminal-context-menu')
        if (menuEl && !menuEl.contains(e.target as Node)) {
          setTimeout(hideContextMenu, 0)
        }
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  }, [contextMenu.visible, hideContextMenu])

  return {
    contextMenu,
    handleContextMenu,
    hideContextMenu,
  }
}