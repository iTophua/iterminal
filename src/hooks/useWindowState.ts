import { useEffect, useRef } from 'react'
import { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor, availableMonitors } from '@tauri-apps/api/window'

const WINDOW_STATE_KEY = 'iterminal_window_state'
const MIN_WIDTH = 800
const MIN_HEIGHT = 600
const MARGIN = 50

interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
  monitorName?: string
}

interface MonitorBounds {
  x: number
  y: number
  width: number
  height: number
}

export function useWindowState() {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isRestoringRef = useRef(false)

  const isValidState = (state: unknown): state is WindowState => {
    if (!state || typeof state !== 'object') return false
    const s = state as WindowState
    if (s.maximized === true) return true
    return (
      typeof s.x === 'number' &&
      typeof s.y === 'number' &&
      typeof s.width === 'number' &&
      typeof s.height === 'number' &&
      typeof s.maximized === 'boolean' &&
      s.width >= MIN_WIDTH &&
      s.height >= MIN_HEIGHT
    )
  }

  const getMonitorByName = async (name: string): Promise<MonitorBounds | null> => {
    try {
      const monitors = await availableMonitors()
      for (const monitor of monitors) {
        if (monitor.name === name) {
          const position = monitor.position
          const size = monitor.size
          const scale = monitor.scaleFactor
          return {
            x: Math.round(position.x / scale),
            y: Math.round(position.y / scale),
            width: Math.round(size.width / scale),
            height: Math.round(size.height / scale),
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  const getCurrentMonitorBounds = async (): Promise<{ bounds: MonitorBounds; name?: string } | null> => {
    try {
      const monitor = await currentMonitor()
      if (!monitor) return null
      
      const position = monitor.position
      const size = monitor.size
      const scale = monitor.scaleFactor
      
      return {
        bounds: {
          x: Math.round(position.x / scale),
          y: Math.round(position.y / scale),
          width: Math.round(size.width / scale),
          height: Math.round(size.height / scale),
        },
        name: monitor.name || undefined,
      }
    } catch {
      return null
    }
  }

  const clampWindowToBounds = (
    state: WindowState,
    bounds: MonitorBounds
  ): WindowState => {
    let { x, y, width, height } = state

    if (width > bounds.width - MARGIN * 2) {
      width = bounds.width - MARGIN * 2
    }
    if (height > bounds.height - MARGIN * 2) {
      height = bounds.height - MARGIN * 2
    }

    width = Math.max(MIN_WIDTH, width)
    height = Math.max(MIN_HEIGHT, height)

    const maxX = bounds.x + bounds.width - width - MARGIN
    const maxY = bounds.y + bounds.height - height - MARGIN
    const minX = bounds.x + MARGIN
    const minY = bounds.y + MARGIN

    x = Math.max(minX, Math.min(maxX, x))
    y = Math.max(minY, Math.min(maxY, y))

    return { ...state, x, y, width, height }
  }

  const restoreState = async () => {
    try {
      const mainWindow = getCurrentWindow()
      const saved = localStorage.getItem(WINDOW_STATE_KEY)
      
      if (!saved) {
        await mainWindow.show()
        return
      }

      let state: WindowState
      try {
        state = JSON.parse(saved)
      } catch {
        localStorage.removeItem(WINDOW_STATE_KEY)
        await mainWindow.show()
        return
      }

      if (!isValidState(state)) {
        localStorage.removeItem(WINDOW_STATE_KEY)
        await mainWindow.show()
        return
      }

      isRestoringRef.current = true

      if (state.maximized && (state.width === undefined || state.height === undefined)) {
        await mainWindow.maximize()
        await mainWindow.show()
      } else {
        let targetBounds: MonitorBounds | null = null
        
        if (state.monitorName) {
          targetBounds = await getMonitorByName(state.monitorName)
        }
        
        if (!targetBounds) {
          const currentMonitorInfo = await getCurrentMonitorBounds()
          if (currentMonitorInfo) {
            targetBounds = currentMonitorInfo.bounds
          }
        }

        if (targetBounds) {
          state = clampWindowToBounds(state, targetBounds)
        }

        await mainWindow.setSize(new LogicalSize(state.width, state.height))
        await mainWindow.setPosition(new LogicalPosition(state.x, state.y))
        await mainWindow.show()
      }
      
      setTimeout(() => {
        isRestoringRef.current = false
      }, 500)
    } catch (error) {
      console.error('Failed to restore window state:', error)
      try {
        await getCurrentWindow().show()
      } catch {}
      isRestoringRef.current = false
    }
  }

  const saveState = async () => {
    if (isRestoringRef.current) return
    
    try {
      const mainWindow = getCurrentWindow()
      const maximized = await mainWindow.isMaximized()
      const monitorInfo = await getCurrentMonitorBounds()
      const scale = monitorInfo ? 1 : (await currentMonitor())?.scaleFactor || 1

      const position = await mainWindow.outerPosition()
      const size = await mainWindow.outerSize()

      const logicalWidth = Math.round(size.width / scale)
      const logicalHeight = Math.round(size.height / scale)

      if (logicalWidth < MIN_WIDTH || logicalHeight < MIN_HEIGHT) {
        return
      }

      const state: WindowState = {
        x: Math.round(position.x / scale),
        y: Math.round(position.y / scale),
        width: logicalWidth,
        height: logicalHeight,
        maximized,
        monitorName: monitorInfo?.name,
      }

      localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state))
    } catch (error) {
      console.error('Failed to save window state:', error)
    }
  }

  const debouncedSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveState()
    }, 300)
  }

  useEffect(() => {
    restoreState()

    let unlistenMove: (() => void) | null = null
    let unlistenResize: (() => void) | null = null

    const setupListeners = async () => {
      const mainWindow = getCurrentWindow()
      
      unlistenMove = await mainWindow.onMoved(debouncedSave)
      unlistenResize = await mainWindow.onResized(debouncedSave)
    }

    setupListeners()

    const handleBeforeUnload = () => {
      saveState()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (unlistenMove) unlistenMove()
      if (unlistenResize) unlistenResize()
      window.removeEventListener('beforeunload', handleBeforeUnload)
      saveState()
    }
  }, [])
}