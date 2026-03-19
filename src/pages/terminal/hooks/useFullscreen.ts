import { useState, useCallback, useRef, useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function useFullscreen(
  fitAddons: React.MutableRefObject<{ [key: string]: any }>,
  setSidebarCollapsed: (collapsed: boolean) => void
) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleToggleFullscreen = useCallback(async (sessionKey: string) => {
    try {
      const appWindow = getCurrentWindow()
      const isMax = await appWindow.isMaximized()
      
      if (isMax || isFullscreen) {
        if (isMax) {
          await appWindow.unmaximize()
        }
        setSidebarCollapsed(false)
        setIsFullscreen(false)
      } else {
        await appWindow.maximize()
        setSidebarCollapsed(true)
        setIsFullscreen(true)
      }
      
      setTimeout(() => {
        fitAddons.current[sessionKey]?.fit()
      }, 100)
    } catch (err) {
      console.error('全屏切换失败:', err)
    }
  }, [isFullscreen, setSidebarCollapsed, fitAddons])

  return {
    isFullscreen,
    handleToggleFullscreen,
  }
}