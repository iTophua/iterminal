import { useState, useEffect } from 'react'
import { STORAGE_KEYS } from '../../../config/constants'

export function useToolbarState() {
  const [toolbarState, setToolbarState] = useState<'full' | 'ball'>('ball')
  const [autoHideToolbar, setAutoHideToolbar] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AUTO_HIDE_TOOLBAR)
    return saved ? saved === 'true' : true
  })
  const [mouseOverBall, setMouseOverBall] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.AUTO_HIDE_TOOLBAR, String(autoHideToolbar))
  }, [autoHideToolbar])

  const showFullToolbar = () => {
    setMouseOverBall(true)
    setToolbarState('full')
  }

  const hideToolbar = () => {
    if (autoHideToolbar) {
      setToolbarState('ball')
      setMouseOverBall(false)
    }
  }

  return {
    toolbarState,
    autoHideToolbar,
    mouseOverBall,
    setAutoHideToolbar,
    setToolbarState,
    setMouseOverBall,
    showFullToolbar,
    hideToolbar,
  }
}