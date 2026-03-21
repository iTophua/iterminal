import { useState, useCallback, useEffect, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function useFullscreen(
  setSidebarCollapsed: (collapsed: boolean) => void,
  fitAddons: React.MutableRefObject<{ [key: string]: any }>
) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isFullscreenRef = useRef(false)

  const handleToggleFullscreen = useCallback(async (_sessionKey?: string) => {
    try {
      const appWindow = getCurrentWindow()
      const isMax = await appWindow.isMaximized()
      
      if (isMax || isFullscreenRef.current) {
        if (isMax) {
          await appWindow.unmaximize()
        }
        setSidebarCollapsed(false)
        setIsFullscreen(false)
        isFullscreenRef.current = false
      } else {
        await appWindow.maximize()
        setSidebarCollapsed(true)
        setIsFullscreen(true)
        isFullscreenRef.current = true
      }
    } catch (err) {
      console.error('全屏切换失败:', err)
    }
  }, [setSidebarCollapsed])

  useEffect(() => {
    const timer = setTimeout(() => {
      Object.values(fitAddons.current).forEach(addon => {
        try { addon?.fit() } catch {}
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [isFullscreen, fitAddons])

  return {
    isFullscreen,
    handleToggleFullscreen,
  }
}