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
    
    const menuWidth = 140
    const menuHeight = 250
    const padding = 8
    
    let x = e.clientX
    let y = e.clientY
    
    if (x + menuWidth + padding > window.innerWidth) {
      x = window.innerWidth - menuWidth - padding
    }
    if (y + menuHeight + padding > window.innerHeight) {
      y = window.innerHeight - menuHeight - padding
    }
    
    x = Math.max(padding, x)
    y = Math.max(padding, y)
    
    setContextMenu({
      x,
      y,
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