import { useState, useCallback } from 'react'

export function useRightPanels(
  activeConnectionId: string | null,
  fileManagerVisible: { [key: string]: boolean },
  setFileManagerVisible: (connectionId: string, visible: boolean) => void
) {
  const [monitorVisible, setMonitorVisible] = useState(false)
  const [apiLogVisible, setApiLogVisible] = useState(false)
  const [snippetsVisible, setSnippetsVisible] = useState(false)
  const [portForwardVisible, setPortForwardVisible] = useState(false)

  const hasAnyPanelOpen =
    monitorVisible ||
    (activeConnectionId && fileManagerVisible[activeConnectionId]) ||
    apiLogVisible ||
    snippetsVisible ||
    portForwardVisible
  const rightPanelWidth = hasAnyPanelOpen ? 392 : 32

  // 关闭除指定面板外的其它面板（保证同时只开一个）
  const closeOthers = useCallback(
    (keep: 'monitor' | 'fileManager' | 'apiLog' | 'snippets' | 'portForward' | null) => {
      if (keep !== 'monitor') setMonitorVisible(false)
      if (keep !== 'apiLog') setApiLogVisible(false)
      if (keep !== 'snippets') setSnippetsVisible(false)
      if (keep !== 'portForward') setPortForwardVisible(false)
      if (keep !== 'fileManager' && activeConnectionId && fileManagerVisible[activeConnectionId]) {
        setFileManagerVisible(activeConnectionId, false)
      }
    },
    [activeConnectionId, fileManagerVisible, setFileManagerVisible]
  )

  const openMonitor = useCallback(() => {
    closeOthers('monitor')
    setMonitorVisible(true)
  }, [closeOthers])

  const openFileManager = useCallback(() => {
    if (!activeConnectionId) return
    const isVisible = fileManagerVisible[activeConnectionId]
    if (isVisible) {
      setFileManagerVisible(activeConnectionId, false)
    } else {
      closeOthers('fileManager')
      setFileManagerVisible(activeConnectionId, true)
    }
  }, [activeConnectionId, fileManagerVisible, setFileManagerVisible, closeOthers])

  const toggleApiLog = useCallback(() => {
    if (apiLogVisible) {
      setApiLogVisible(false)
    } else {
      closeOthers('apiLog')
      setApiLogVisible(true)
    }
  }, [apiLogVisible, closeOthers])

  const toggleSnippets = useCallback(() => {
    if (snippetsVisible) {
      setSnippetsVisible(false)
    } else {
      closeOthers('snippets')
      setSnippetsVisible(true)
    }
  }, [snippetsVisible, closeOthers])

  const togglePortForward = useCallback(() => {
    if (portForwardVisible) {
      setPortForwardVisible(false)
    } else {
      closeOthers('portForward')
      setPortForwardVisible(true)
    }
  }, [portForwardVisible, closeOthers])

  return {
    monitorVisible,
    setMonitorVisible,
    apiLogVisible,
    setApiLogVisible,
    snippetsVisible,
    setSnippetsVisible,
    portForwardVisible,
    setPortForwardVisible,
    rightPanelWidth,
    openMonitor,
    openFileManager,
    toggleApiLog,
    toggleSnippets,
    togglePortForward,
  }
}
