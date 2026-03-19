import { useState, useCallback, useEffect, useRef } from 'react'

export function useRightPanels(
  activeConnectionId: string | null,
  fileManagerVisible: { [key: string]: boolean },
  setFileManagerVisible: (connectionId: string, visible: boolean) => void
) {
  const [monitorVisible, setMonitorVisible] = useState(false)
  const [apiLogVisible, setApiLogVisible] = useState(false)

  const getRightPanelWidth = useCallback(() => {
    let width = 0
    if (monitorVisible) width += 320
    if (activeConnectionId && fileManagerVisible[activeConnectionId]) width += 360
    if (apiLogVisible) width += 380
    return width
  }, [monitorVisible, activeConnectionId, fileManagerVisible, apiLogVisible])

  const rightPanelWidth = getRightPanelWidth()
  const prevPanelWidthRef = useRef(rightPanelWidth)

  const openMonitor = useCallback(() => {
    setMonitorVisible(true)
    if (activeConnectionId && fileManagerVisible[activeConnectionId]) {
      setFileManagerVisible(activeConnectionId, false)
    }
    setApiLogVisible(false)
  }, [activeConnectionId, fileManagerVisible, setFileManagerVisible])

  const openFileManager = useCallback(() => {
    if (!activeConnectionId) return
    const isVisible = fileManagerVisible[activeConnectionId]
    setFileManagerVisible(activeConnectionId, !isVisible)
    if (!isVisible) {
      setMonitorVisible(false)
      setApiLogVisible(false)
    }
  }, [activeConnectionId, fileManagerVisible, setFileManagerVisible])

  const toggleApiLog = useCallback(() => {
    const newVisible = !apiLogVisible
    setApiLogVisible(newVisible)
    if (newVisible) {
      setMonitorVisible(false)
      if (activeConnectionId && fileManagerVisible[activeConnectionId]) {
        setFileManagerVisible(activeConnectionId, false)
      }
    }
  }, [apiLogVisible, activeConnectionId, fileManagerVisible, setFileManagerVisible])

  return {
    monitorVisible,
    setMonitorVisible,
    apiLogVisible,
    setApiLogVisible,
    rightPanelWidth,
    prevPanelWidthRef,
    openMonitor,
    openFileManager,
    toggleApiLog,
  }
}